'use strict';

const fs = require("fs");

let statusGlobal					= require("./status.json");
let status 							= statusGlobal.channels;
let measurements					= require("./measurements.json");
const influx 						= require("./influxhandler");
const globalConfig					= require("../config");
const InstrumentController			= require("../instrumentcontroller");
const HostManager					= require("../hostmanager");
const waveform						= require("jsgraph-waveform");
const wsconnection					= require('../wsconnection' );

let connections = {};
let intervals = {};
let thermal_modules = {};

thermal_modules.ztp_101t = require( '../config/sensors/ztp_101t' );

function saveStatus() {
	
	return fs.writeFileSync(
		"./trackercontroller/status.json", 
		JSON.stringify( statusGlobal, undefined, "\t" ) 
	);
}

class TrackerController extends InstrumentController {

	constructor( config ) {

		super( ...arguments );

		this.processTimer = this.processTimer.bind( this );
		this.processTimer();
	
		this.groupTemperature = {};
		this.groupHumidity = {};
		this.groupLightIntensity = {};
		this.temperatures = {};
		this.lightSetpoint = {};
		this.heaterCode = {};
		this.preventMPPT = {};
		this.pdIntensity = {};

		this.trackData = [];
		this.paused = false;

		this._creation = Date.now();

	}	


	init() {

		this.trackData = [];		

		this.openConnection( async () => {
			
			await this.configure();
		} );
	}

	async configure() {

		await delay( 2000 );
		await this.pauseChannels();
		await this.query( "RESERVED:SETUP" );
		await this.normalizeStatus();
		await this.resumeChannels();
		await this.scheduleEnvironmentSensing( 2000 );
		await this.scheduleLightSensing( 10000 );
		await this.lightSensing(); // Normalize the light sensing
		await this.heatUpdate(); // Normalize the light sensing

		this.setTimer( "saveTrackData", "", this.saveTrackData, 60000 ); // Save the data every 60 seconds
		await this.query( "RESERVED:CONFIGURED" );
		this.configured = true;
	}

	kill() {

		for( let controller of this.lightControllers ) {
			controller.kill();
		}

		super.kill();
	}

	getGroupFromChanId( chanId ) {

		const cfg = this.getInstrumentConfig();

		for( var i = 0; i < cfg.groups.length; i ++ ) {

			for( var j = 0; j < cfg.groups[ i ].channels.length; j ++ ) {

				if( cfg.groups[ i ].channels[ j ].chanId == chanId ) {

					return cfg.groups[ i ];
				}
			}
		}
	}

	getGroupFromGroupName( groupName ) {

		const cfg = this.getInstrumentConfig();

		for( var i = 0; i < cfg.groups.length; i ++ ) {

			if( cfg.groups[ i ].groupName == groupName ) {

				return cfg.groups[ i ];
			}
		}

		console.trace();
		throw "Cannot find the group with group name " + groupName;
	}

	getInstrumentConfig( groupName, chanId ) {

		if( groupName === undefined && chanId === undefined ) {
			return super.getInstrumentConfig();
		}

		const cfg = this.getInstrumentConfig();

		for( var i = 0; i < cfg.groups.length; i ++ ) {

			if( cfg.groups[ i ].groupName == groupName || groupName === undefined ) {

				if( chanId === undefined && cfg.groups[ i ].groupName == groupName ) {
					return cfg.groups[ i ];
				}

				for( var j = 0; j < cfg.groups[ i ].channels.length; j ++ ) {

					if( cfg.groups[ i ].channels[ j ].chanId == chanId ) {

						return cfg.groups[ i ].channels[ j ];
					}
				}
			}
		}
	}


	/**
	 *	Writes a command to the instrument, and adds a trailing EOL
	 *	@param {String} command - The command string to send
	 */
	query( command, lines = 1, executeBefore, prependToQueue = false, rawOutput, expectedBytes ) {
	
		if( ! this.open ) {
			console.trace();
			throw "Cannot write command \"" + command + "\" to the instrument. The instrument communication is closed."
		}

		return super.query( command, lines, executeBefore, prependToQueue, rawOutput, expectedBytes );
	}



	/**
	 *	Upload the default status of the state
	 */
	async normalizeStatus() {

		const cfg = this.getInstrumentConfig(),
			  groups = cfg.groups;

		let instrumentId = cfg.instrumentId, 
			chanId;

		//await this.setAcquisitionSpeed( statusGlobal.acquisitionSpeed );

		for( var i = 0, m = groups.length; i < m ; i ++ ) {
		
			for( var j = 0, l = groups[ i ].channels.length; j < l; j ++ ) {

				chanId = groups[ i ].channels[ j ].chanId;

				if( ! this.statusExists( chanId ) ) {

					status.push( Object.assign( {}, globalConfig.trackerControllers.defaults, {
						chanId: chanId,
						instrumentId: instrumentId
					} ) );
				}

				await this.updateInstrumentStatusChanId( chanId, {}, true, false );
			}
		}

		saveStatus();
	}


	/**
	 *	@returns the instrument unique ID
	 */
	getInstrumentId() {
		return this.getInstrumentConfig().instrumentId;
	}


	/**
	 *	@returns the status of a particular channel
	 */
	getStatus( chanId ) {
			
		return status[ this.getStatusIndex( chanId ) ];
	}


	/**
	 *	@returns the status index of a particular channel
	 */
	getStatusIndex( chanId ) {
		
		for( var i = 0; i < status.length; i ++ ) {

			if( status[ i ].chanId == chanId && status[ i ].instrumentId == this.getInstrumentId() ) {

				return i;
			}
		}

		throw "No channel associated with this chanId (" + chanId + ")";
	}

	/**
	 *	@returns whether the status of a particular channel exists
	 */
	statusExists( chanId ) {
		
		try {

			this.getStatusIndex( chanId );
			return true;

		} catch( e ) {

			return false;
		}
	}

	hasChanged( parameter, newValue ) {

		if( ! Array.isArray( parameter ) ) {
			parameter = [ parameter ];
		}

		return _hasChanged( parameter, this.getStatus(), { [ parameter ]: newValue } );
	}

	/**
	 *	Forces the update of all channels. Pauses the channel tracking
	 */
	async updateAllChannels() {

		await this.pauseChannels();

		for( let i = 0; i < status.length; i++ ) {
			await updateInstrumentStatusChanId( status[ i ].instrumentId, status[ i ].chanId, [], true );
		}

		await this.resumeChannels();
	}

	async setAcquisitionSpeed( speed ) {
		await this.query( globalConfig.trackerControllers.specialcommands.acquisition.speed( speed ) )
		statusGlobal.acquisitionSpeed = speed;
		saveStatus();
	}

	getAcquisitionSpeed( ) {
		return statusGlobal.acquisitionSpeed;
	}

	async pauseChannels() {

		if( this.paused ) {
			return;
		}

		return this.query( globalConfig.trackerControllers.specialcommands.pauseHardware, 1, undefined, true ).then( () => {
			this.paused = true;
		});
	}


	async resumeChannels() {
		
		return this.query( globalConfig.trackerControllers.specialcommands.resumeHardware, 1, undefined, true ).then( () => {
			this.paused = false;
		});
	}



	getGroups() {

		return this.getInstrumentConfig().groups;
	}

	getChannels( groupName = "" ) {

		for( let group of this.getInstrumentConfig().groups ) {

			if( group.groupName == groupName )  {

				return group.channels;
			}
		}

		return [];
	}


	setVoltage( chanId, voltageValue ) {
		return this.query( globalConfig.trackerControllers.specialcommands.setVoltage( chanId, voltageValue ) );
	}


	async resetStatus( chanId ) {

		let index = this.getStatusIndex( chanId );
		let status = this.getStatus( chanId );

		measurementEnd( status.measurementName );

		this.saveStatus( chanId, globalConfig.trackerControllers.defaults );
		status[ index ] = Object.assign( {}, globalConfig.trackerControllers.defaults, { chanId: chanId, instrumentId: this.getInstrumentId() } );

		wsconnection.send( {

			instrumentId: this.getInstrumentId(),
			chanId: chanId,

			action: {
				stopped: true
			}
		} );
	}



	/**
	 *	Updates the status of a channel. Uploads it to the instrument and saves it
	 *	@param {Number} chanId - The channel ID
	 *	@param {Object} newStatus - The new status
	 */
	async saveStatus( chanId, newStatus, noSave ) {

		if( this.getInstrumentId() === undefined || chanId === undefined ) {
			throw "Cannot set channel status";
		}

		let previousStatus = Object.assign( {}, this.getStatus( chanId ) );

		// IV curve interval
		this._setStatus( chanId, "iv_interval", parseInt( newStatus.iv_interval ), newStatus );	
		
		// Tracking output interval
		this._setStatus( chanId, "tracking_record_interval", parseInt( newStatus.tracking_record_interval ), newStatus );

		// Tracking sampling interval
		this._setStatus( chanId, "tracking_interval", parseFloat( newStatus.tracking_interval ), newStatus );
		

		this._setStatus( chanId, "tracking_measure_voc_interval", Math.max( 60000, parseInt( newStatus.tracking_measure_voc_interval ) ), newStatus );
		this._setStatus( chanId, "tracking_measure_jsc_interval", Math.max( 60000, parseInt( newStatus.tracking_measure_jsc_interval ) ), newStatus );

		this._setStatus( chanId, "tracking_measure_voc", +newStatus.tracking_measure_voc, newStatus );
		this._setStatus( chanId, "tracking_measure_jsc", +newStatus.tracking_measure_jsc, newStatus );

		// Forward - backward threshold
		this._setStatus( chanId, "tracking_fwbwthreshold", Math.min( 1, Math.max( 0, parseFloat( newStatus.tracking_fwbwthreshold ) ) ), newStatus );	

		// Backward - forward threshold
		this._setStatus( chanId, "tracking_bwfwthreshold", Math.min( 1, Math.max( 0, parseFloat( newStatus.tracking_bwfwthreshold ) ) ), newStatus );	

		// Step size
		this._setStatus( chanId, "tracking_step", Math.max( 0, parseFloat( newStatus.tracking_stepsize ) ), newStatus );	

		// Delay upon direction switch
		this._setStatus( chanId, "tracking_switchdelay", Math.max( 0, parseFloat( newStatus.tracking_switchdelay ) ), newStatus );	

		// Acquisition gain
		this._setStatus( chanId, "tracking_gain", parseInt( newStatus.tracking_gain ) == -1 ? -1 : Math.max( Math.min( 128, parseInt( newStatus.tracking_gain ) ) ), newStatus );	

		// IV start point
		this._setStatus( chanId, "iv_start", parseFloat( newStatus.iv_start ), newStatus );	

		// Autostart IV
		this._setStatus( chanId, "iv_autostart", !! newStatus.iv_autostart, newStatus );	

		// IV stop point
		this._setStatus( chanId, "iv_stop", parseFloat( newStatus.iv_stop ), newStatus );	

		// IV hysteresis
		this._setStatus( chanId, "iv_hysteresis", !! newStatus.iv_hysteresis, newStatus );	

		// IV scan rate
		this._setStatus( chanId, "iv_rate", Math.max( 0.001, parseFloat( newStatus.iv_rate ) ), newStatus );	

		this._setStatus( chanId, "connection", newStatus.connection, newStatus );

		this._setStatus( chanId, "enable", newStatus.enable ? 1 : 0, newStatus );

	
		// Updates the stuff unrelated to the tracking

		this._setStatus( chanId, "measurementName", newStatus.measurementName, newStatus );
		this._setStatus( chanId, "cellName", newStatus.cellName, newStatus );
		this._setStatus( chanId, "cellArea", parseFloat( newStatus.cellArea ), newStatus );
		this._setStatus( chanId, "lightRefValue", parseFloat( newStatus.lightRefValue ), newStatus );

		
		if( newStatus.measurementName !== previousStatus.measurementName && newStatus.measurementName ) {
			possibleNewMeasurement( newStatus.measurementName, newStatus );
		}


		let newMode;

		newStatus.tracking_mode = parseInt( newStatus.tracking_mode );
		switch( newStatus.tracking_mode ) {

			case 2:
				newMode = 2;
			break;

			case 3:
				newMode = 3;
			break;

			case 1:
				newMode = 1;
			break;

			default:
			case 0:
				newMode = 0;
			break;
		}

		this._setStatus( chanId, "tracking_mode", newMode, newStatus );
		
		if( ! noSave ) {
			saveStatus();
		}
		
		wsconnection.send( {

			instrumentId: this.getInstrumentId(),
			chanId: chanId,

			action: {
				update: true
			}
		} );

		await this.updateInstrumentStatusChanId( chanId, previousStatus );
	}

	enableChannel( chanId ) {
		return this.saveStatus( chanId, { enable: true } );
	}

	disableChannel( chanId ) {
		return this.saveStatus( chanId, { enable: false } );
	}

	measureCurrent( chanId ) {
		return this.query( globalConfig.trackerControllers.specialcommands.measureCurrent( chanId ), 2 ).then( ( current ) => parseFloat( current ) );
	}

	_setStatus( chanId, paramName, paramValue, newStatus, save ) {

		let instrumentId = this.getInstrumentId();

		if( newStatus && ! newStatus.hasOwnProperty( paramName ) ) {
			return;
		}

		if( ! this.statusExists( chanId ) ) {
			status[ chanId ] = {
				chanId: chanId,
				instrumentId: instrumentId
			};
		}

		for( var i = 0; i < status.length; i ++ ) {

			if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {

				status[ i ][ paramName ] = paramValue;
			}
		}

		if( save ) {
			saveStatus();
		}
	}


	async updateInstrumentStatusChanId( chanId, previousState = {}, force = false, pauseChannels = true ) {

		let instrumentId = this.getInstrumentId(),
			status = this.getStatus( chanId ),
			comm = this.getConnection(),
			group = this.getGroupFromChanId( chanId );

		if( status.enable == 0 ) {
			
			this.removeTimer( "track", chanId );
			this.removeTimer( "voc", chanId );
			this.removeTimer( "jsc", chanId );
			this.removeTimer( "iv", chanId );
		}

		if( pauseChannels ) {
			await this.pauseChannels();
		}

		for( let cmd of globalConfig.trackerControllers.statuscommands ) {

			if( !force && ( cmd[ 1 ]( status, group ) === cmd[ 1 ]( previousState ) ) ) {
				continue;
			}

			await this.query( cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( status, group ), 1, undefined, true );
		}

		if( pauseChannels ) {
			await this.resumeChannels();	
		}


		if( this.getInstrumentConfig().relayController ) {
			if( status.connection == "external" ) {

				HostManager.getHost( this.getInstrumentConfig().relayController ).enableRelay( chanId );
			} else {

				HostManager.getHost( this.getInstrumentConfig().relayController ).disableRelay( chanId );
			}
		}

		if( status.enable !== 0 ) {
		 
			// Handle IV scheduling
			if( 
				( // If there is no timeout yet and there should be one...
					! this.timerExists( "iv", chanId ) 
						&& 
					Number.isInteger( status.iv_interval )
				) 
				|| 
				// Or if this timeout has changed
				_hasChanged( [ "iv_interval" ], status, previousState ) 
			) {

				this.setTimer( "iv", chanId, this.makeIV, status.iv_interval );
			}
			


			// Scheduling Voc. Checks for applicability are done later
			if( 

				status.tracking_measure_voc && (
					! this.timerExists( "voc", chanId ) 
					|| _hasChanged( [ "enabled", "tracking_measure_voc", "tracking_measure_voc_interval"], status, previousState ) 
				)

				) {

				this.setTimer("voc", chanId, this.measureVoc, status.tracking_measure_voc_interval );				
			} else {
				this.removeTimer("voc", chanId );
			}

			// Scheduling Jsc. Checks for applicability are done later
			if( status.tracking_measure_jsc
				&& (
					! this.timerExists( "jsc", chanId ) 
						|| 
					_hasChanged( [ "enabled", "tracking_measure_jsc", "tracking_measure_jsc_interval"], status, previousState ) 
					)
			) {

				this.setTimer("jsc", chanId, this.measureJsc, status.tracking_measure_jsc_interval );

			} else {
				this.removeTimer( "jsc", chanId );
			}


			var setTrackTimer = () => {

				if( ! status.tracking_mode || ! status.enable ) {

					this.removeTimer( "track", chanId );
					
				} else if( 
					! this.timerExists( "track", chanId )  
					|| _hasChanged( [ "enabled", "tracking_mode", "tracking_record_interval"], status, previousState ) 
					&& status.tracking_record_interval > 0 
					&& status.tracking_mode
					&& status.tracking_record_interval !== null 
					&& status.tracking_record_interval !== undefined ) {

					this.setTimer( "track", chanId, this.getTrackDataInterval, status.tracking_record_interval ); // Setup the timer

				}
			}

			( async () => {

				if( previousState.enable == 0 && status.enable == 1 ) { // Off to tracking

					let iv = await this.makeIV( chanId ),
						pow = iv.math( ( y, x ) => { return x * y } ),
						maxEff = pow.getMax(),
						maxEffLoc = pow.findLevel( maxEff ),
						maxEffVoltage = pow.getX( maxEffLoc );


						
					if( ! isNaN( maxEffVoltage ) ) {
						await this.setVoltage( chanId, maxEffVoltage );
						setTrackTimer();
					} else {
						console.log( "Error in finding the maximum voltage" );
						setTrackTimer();
					}

				} else {
					setTrackTimer();
				}

			} ) ();
		}
	}


	scheduleEnvironmentSensing( interval ) {

		//if( this.timerExists( "pd" ) ) {
			this.setTimer("env", undefined, this.measureEnvironment, interval );
		//} 
	}


	//////////////////////////////////////
	// LIGHT MANAGEMENT
	//////////////////////////////////////


	scheduleLightSensing( interval ) {

		//if( this.timerExists( "pd" ) ) {

			this.setTimer("light", undefined, this.lightSensing, interval );

		//} 
	}

	async measureEnvironment() {

		let groups = this.getInstrumentConfig().groups;
		let temperature, lights, humidity;

		for( let group of groups ) {
				
			let data = {
				paused: this.paused
			};

			if( group.humiditySensor ) {
				const humidity = await this.measureGroupHumidityTemperature( group.groupName );
				data.temperature = humidity.temperature;
				data.humidity = humidity.humidity;
			}

			if( group.heat ) {

				Object.assign( data, {
					heater_status: await this.heaterIsEnabled( group.groupName ),
					heater_voltage: Math.round( await this.heaterGetVoltage( group.groupName ) * 100 ) / 100,
					heater_current: Math.round( await this.heaterGetCurrent( group.groupName ) * 100 ) / 100,
				} );

				data.heater_power = Math.round( data.heater_voltage * data.heater_current * 100 ) / 100;
			}

			if( group.light ) {

				Object.assign( data, {
					lightOnOff: group.light.on,
					lightOnOffButton: await this.lightIsEnabled( group.groupName ),
					lightMode: await this.lightIsAutomatic( group.groupName ) ? 'auto' : 'manual',
					lightSetpoint: this.lightSetpoint[ group.groupName ],
					lightValue: await this.measureGroupLightIntensity( group.groupName ),
				} );

			}
			
			if( group.temperatureSensors && Array.isArray( group.temperatureSensors ) ) {
				
				for( let sensor of group.temperatureSensors ) {

					let thermistor = await this.readBaseTemperature( sensor.thermistor );
					let thermopile = await this.readIRTemperature( sensor.thermopile );

					for( let chan of sensor.channels ) {
						
						this.temperatures[ group.groupName ] = this.temperatures[ group.groupName ] || {}; 
						this.temperatures[ group.groupName ][ chan ] = [ Math.round( ( thermistor + thermopile ) * 10 ) / 10, Math.round( thermistor * 10 ) / 10, Math.round( thermopile * 10 ) / 10 ];
					}
				}
			}
			
			wsconnection.send( {
				instrumentId: this.getInstrumentId(),
				groupName: group.groupName,
				data: data
			} );

		}
	}


	async lightSetControl( groupName, control ) {

		let group = this.getGroupFromGroupName( groupName );

		if( ! group.light ) {
			throw "Cannot update the light controller for this group: a light control must pre-exist."
		}

		Object.assign( group.light, control );
		// Push the new control values to the uC
		await this.lightSensing();
		await this.measureEnvironment(); // Re-measure the light values, setpoint, and so on
	}

	lightGetControl( groupName ) {
		
		let group = this.getGroupFromGroupName( groupName );
		if( ! group.light ) {
			throw "Cannot retrieve the light controller for this group: no light control exists."
		}

		return group.light;
	}

	async lightSensing() {

		let groups = this.getInstrumentConfig().groups;

		for( let group of groups ) {

			if( ! group.light ) {
				continue;
			}

			if( group.light.on ) { // Normalisation of the light status
				await this.lightEnable( group.groupName );
			} else {
				await this.lightDisable( group.groupName );
			}

			// Set the mA to sun scaling value
			await this.lightSetScaling( group.groupName, group.light.scaling );


			if( group.light.scheduling && group.light.scheduling.enabled ) { // Scheduling mode, let's check for new setpoint ?

				// this._scheduling.startDate = Date.now();
				const ellapsed = ( Date.now() - this._creation ) % group.light.scheduling.basis;
				const waveform = new Waveform().setData( group.light.scheduling.intensities );
				const index = waveform.getIndexFromX( ellapsed );
				const intensityValue = waveform.getY( index );

				if( intensityValue !== this.lightSetpoint[ group.groupName ] ) {

					await this.lightSetSetpoint( group.groupName, intensityValue );
					this.lightSetpoint[ group.groupName ] = intensityValue;
				}

			} else if ( group.light.setPoint !== this.lightSetpoint[ group.groupName ] ) {

				await this.lightSetSetpoint( group.groupName, group.light.setPoint );
				this.lightSetpoint[ group.groupName ] = group.light.setPoint;
			}

			await this.lightCheck( group.groupName );
		}
	}

	async _lightCommand( groupName, command, value, request ) {

		const group = this.getGroupFromGroupName( groupName );

		if( ! groupName ) {
			throw new Error(`No light configuration for the group ${ groupName }` );
		}


		if( group.light.channelId ) {
			return this.query( globalConfig.trackerControllers.specialcommands.light[ command ]( group.light.channelId, value ), request ? 2 : 1 );	
		}

		
		throw new Error(`No light channel was defined for the group ${ groupName }. Check that the option "channelId" is set and different from null or 0.`);	
	}

	async lightEnable( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		group.light.on = true;
		const returnValue = this._lightCommand( groupName, 'enable' );
		return returnValue;
	}

	async lightDisable( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		group.light.on = false;
		const returnValue = this._lightCommand( groupName, 'disable' );
		return returnValue;
	}

	async lightIsEnabled( groupName ) {
		return this._lightCommand( groupName, 'isEnabled', undefined, true ).then( value => value == "1" );
	}

	async lightIsAutomatic( groupName ) {
		return this._lightCommand( groupName, 'isAutomatic', undefined, true ).then( value => value == "1" );
	}
	
	async lightSetSetpoint( groupName, setpoint ) {
		const group = this.getGroupFromGroupName( groupName );
		group.light.setPoint = setpoint;
		return this._lightCommand( groupName, 'setSetpoint', setpoint );
	}

	async lightCheck( groupName, setpoint ) {
		const group = this.getGroupFromGroupName( groupName );
		return this._lightCommand( groupName, 'check', undefined, true ).then( val => console.log( val ) );
	}

	async lightSetScaling( groupName, scaling ) {
		const group = this.getGroupFromGroupName( groupName );
		group.light.scaling = scaling;
		return this._lightCommand( groupName, 'setScaling', scaling );
	}

	async measureGroupLightIntensity( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		if( group.light.channelId ) {
			return this.measurePD( group.light.channelId );	
		}
		return -1;
	}

	async measureChannelLightIntensity( channelId ) {
		const group = this.getGroupFromChanId( channelId );
		const channelIdPD = group.light.channelId;
		return this.measurePD( channelIdPD );
	}

	async getChannelLightIntensity( chanId, defaultValue ) {

		const status = this.getStatus( chanId );
		

		if( status.lightRefValue ) { // If the value is forced
			return status.lightRefValue / 1000;
		}

		if( defaultValue ) { // If there's already a default value
			return defaultValue;
		}
		
		return this.measureChannelLightIntensity( chanId );
	}



	async measurePD( channelId ) {
		return parseFloat( await this.query( globalConfig.trackerControllers.specialcommands.readPD.sun( channelId ), 2 ) );
	}

	async measurePDCurrent( channelId ) {
		return parseFloat( await this.query( globalConfig.trackerControllers.specialcommands.readPD.current( channelId ), 2 ) );	
	}

	async resetSlave() {
		return this.query( globalConfig.trackerControllers.specialcommands.resetSlave );
	}


	async heaterIsEnabled( groupName ) {
		return this._heatCommand( groupName, 'isEnabled', undefined, true ).then( value => value == "1" );
	}

	async heaterEnable( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		group.heat.enable = true;
		return this._heatCommand( groupName, 'enable', undefined ).then( value => value == "1" );
	}

	async heaterDisable( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		group.heat.enable = false;
	//	const group = this.getGroupFromGroupName( groupName );
		return this._heatCommand( groupName, 'disable', undefined ).then( value => value == "1" );
	}

	async heaterGetVoltage( groupName ) {
		return this._heatCommand( groupName, 'getVoltage', undefined, true ).then( val => parseFloat( val ) );
	}

	async heaterGetCurrent( groupName ) {
		return this._heatCommand( groupName, 'getCurrent', undefined, true ).then( val => parseFloat( val ) );
	}

	async heatUpdate(  ) {


		let groups = this.getInstrumentConfig().groups;

		for( let group of groups ) {

			if( ! group.heat ) {
				continue;
			}

			await this.setHeatingPower( group.groupName, group.heat.power );
		}
	}

	async setHeatingPower( groupName, power ) {
		
		const group = this.getGroupFromGroupName( groupName );
		
		if( isNaN( power ) ) {
			return;
		}

		if( power > 1 ) {
			power = 1;
		}

		if( power < 0 ) {
			power = 0;
		}

		const setVoltage = power * group.heat.maxVoltage;
		let rbottom = 0.75 * 82000 / ( setVoltage - 0.75 );
		rbottom = 50000 - rbottom;
		let rbottomcode = Math.round( rbottom / 50000 * 256 );

		if( rbottomcode < 0 ) {
			rbottomcode = 0;
		} else if( rbottomcode > 255 ) {
			rbottomcode = 255;
		}
		
		if( isNaN( rbottomcode ) ) {
			return;
		}

		group.heat.power = power;

		if( setVoltage < 1 ) {
			//await this._heatCommand( groupName, "disable", undefined );
			//group.heat.on = false;
		} else {
			//await this._heatCommand( groupName, "enable", undefined );
			//group.heat.on = true;
			await this._heatCommand( groupName, "setPower", rbottomcode );
		}
	}

	async increaseHeatingPower( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		return this.setHeatingPower( groupName, ( group.heat.power || 0 ) + 0.05 );
	}

	async decreaseHeatingPower( groupName ) {
		const group = this.getGroupFromGroupName( groupName );
		return this.setHeatingPower( groupName, ( group.heat.power || 0 ) - 0.05 );
	}

	async _heatCommand( groupName, command, value, request ) {

		const group = this.getGroupFromGroupName( groupName );

		if( ! groupName ) {
			throw new Error(`No light configuration for the group ${ groupName }` );
		}

		if( group.heat.channelId ) {
			return this.query( globalConfig.trackerControllers.specialcommands.dcdc[ command ]( group.heat.channelId, value ), request ? 2 : 1 );	
		}

		throw new Error(`No light channel was defined for the group ${ groupName }. Check that the option "channelId" is set and different from null or 0.`);	
	}



	async readBaseTemperature( cfg ) {
		const t0 = 273.15;
		const buffer = await this.query( globalConfig.trackerControllers.specialcommands.readTemperatureChannelBase( cfg.I2CAddress, cfg.ADCChannel ), 2, undefined, false, true, 2 );
		const int = buffer.readInt16BE( 0 ) / 16;
		const vout = int / 2047 * 2.048; // 12 bit word ( 0 - 2047 ) * PGA value (2.048V)


		const thermistor = vout * cfg.resistor / ( cfg.vref - vout );
		
		const t = ( ( 1 / ( 25 + t0 ) +  ( 1 / thermal_modules[ cfg.model ].thermistor.beta ) * Math.log( thermistor / thermal_modules[ cfg.model ].thermistor.r0 ) ) ** -1 ) - t0;
		return t;
	}


	async readIRTemperature( cfg ) {

		const buffer = await this.query( globalConfig.trackerControllers.specialcommands.readTemperatureChannelIR( cfg.I2CAddress, cfg.ADCChannel ), 2, undefined, false, true, 2 );
//		console.log( buffer.readInt16BE( 0 ), buffer.readInt16BE( 0 ) / 16 / 2047 * 2.048 );
		let vout = ( buffer.readInt16BE( 0 ) / 16 - cfg.offset ) / 2047 * 2.048 / cfg.gain; // Sensor voltage

		
		const coeffs = thermal_modules[ cfg.model ].thermopile.polynomialCoefficients;
		vout *= 1000;
		const deltaT = coeffs[ 0 ] * 0 + // Rescale to 0
						+ ( vout ** 1 ) * coeffs[ 1 ] 
						+ ( vout ** 2 ) * coeffs[ 2 ] 
						+ ( vout ** 3 ) * coeffs[ 3 ] 
						+ ( vout ** 4 ) * coeffs[ 4 ] 
						+ ( vout ** 5 ) * coeffs[ 5 ]
						+ ( vout ** 6 ) * coeffs[ 6 ]
						+ ( vout ** 7 ) * coeffs[ 7 ]
						+ ( vout ** 8 ) * coeffs[ 8 ];


		console.log( vout, deltaT );
		return deltaT;
	}


	getSensorConfig( chanId ) {
		const group = this.getGroupFromChanId( chanId );
		const temperatureSensors = group.temperatureSensors;
		for( let sensor of temperatureSensors ) {
			if( sensor.channels.indexOf( chanId ) > -1 ) {
				return sensor;
			}
		}
	}

	getGroupTemperature( groupName ) {

		return this.groupTemperature[ groupName ];
	}

	async measureGroupHumidityTemperature( groupName ) {

		let group = this.getGroupFromGroupName( groupName );
		let data = await this.query( globalConfig.trackerControllers.specialcommands.readHumidity( group.humiditySensor.address ), 3 )

		this.groupHumidity[ groupName ] = Math.round( 1000 * parseFloat( data[ 1 ] ) ) / 10 ;
		this.groupTemperature[ groupName ] = Math.round( 10 * parseFloat( data[ 0 ] ) ) / 10;

		return {
			humidity: this.groupHumidity[ groupName ],
			temperature: this.groupTemperature[ groupName ]
		};
	}

	getGroupHumidity( groupName ) {

		return this.groupHumidity[ groupName ];
	}

	//////////////////////////////////////
	// IV CURVES
	//////////////////////////////////////


	async processTimer() {

		let now;


		for( var i in intervals ) {

			now = Date.now();

			if( now - intervals[ i ].lastTime > intervals[ i ].interval && intervals[ i ].activated ) {

				try {
					
					if( ! this.paused ) {
						intervals[ i ].lastTime = Date.now();
						await intervals[ i ].callback( intervals[ i ].chanId ); // This must not fail !
					}
					
				} catch( e ) {

					console.warn( e );
					//throw( e );

				} finally { // If it does, restart the timer anyway

					intervals[ i ].lastTime = Date.now();
				}
			}
		}

		setTimeout( this.processTimer, 1000 );
	}


	setTimer( timerName, chanId, callback, interval, lastTime = Date.now() ) {

				// Let's set another time
		const intervalId = this.getIntervalName( timerName, chanId );

		callback = callback.bind( this );

		intervals[ intervalId ] = {

			interval: interval,
			chanId: chanId,
			lastTime: lastTime,
			activated: true,
			callback: callback
		}
	}

	getTimerNext( timerName, chanId ) {

		const intervalId = this.getIntervalName( timerName, chanId );

		if( ! intervals[ intervalId ] ) {
			return undefined;
		}

		return intervals[ intervalId ].interval + intervals[ intervalId ].lastTime - Date.now();
	}


	async saveTrackData( ) {

		let chans = new Set();

		if( ! Array.isArray( this.trackData ) || this.trackData.length == 0 ) {
			return;
		}
		
		await influx.saveTrackData( this.trackData.map( ( data ) => { chans.add( data.chanId ); return data.influx; } ) );

		chans.forEach( chan => {

			wsconnection.send( {

				instrumentId: this.getInstrumentId(),
				chanId: chan,
				action: {
					saved: true
				}
			} );
		} );

		this.trackData = [];
	}



	getIntervalName( timerName, chanId ) {

		return this.getInstrumentId() + "_" + chanId + "_" + timerName;
	}

	getTimer( timerName, chanId ) {

		const intervalName = this.getIntervalName( timerName, chanId );

		if( ! intervals[ intervalName ] ) {
			throw "The timer with id " + intervals[ timerName ] + ""
		}

		return intervals[ intervalName ];
	}


	timerExists( timerName, chanId ) {

		return !! intervals[ this.getIntervalName( timerName, chanId ) ];
	}

	removeTimer( timerName, chanId ) {

		if( ! this.timerExists( timerName, chanId ) ) {
			return;
		}

		intervals[ this.getIntervalName( timerName, chanId ) ].activated = false;
	}


	//////////////////////////////////////
	// IV CURVES
	//////////////////////////////////////

	async makeIV( chanId ) {
		
		this._setStatus( chanId, 'iv_booked', true, undefined, true );

		return this
			.getStateManager() // State manager for non parallel querying (i.e. no 2 parallel iv curve, no parallel voc and jsc measurement)
			.addQuery( async () => {

				var status = this.getStatus( chanId );

				this.preventMPPT[ chanId ] = true;

				if( ! status.enable ) {
					throw "Channel not enabled";
				}

			//	let light = await this.getChannelLightIntensity( chanId );
				await this.requestIVCurve( chanId );
				while( await this.requestIVCurvePolling( ) ) {
					await delay( 1000 ); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
				}

				let ivcurveData = await this.requestIVCurveData();

				ivcurveData.shift();

				const light = 1;

				influx.storeIV( status.measurementName, ivcurveData, light );
				
				wsconnection.send( {

					instrumentId: this.getInstrumentId(),
					chanId: chanId,

					action: {
						ivCurve: true
					}
				} );

				this.preventMPPT[ chanId ] = false;

				this._setStatus( chanId, 'iv_booked', false, undefined, true );

				const wave = new waveform();

				for( let i = 0; i < ivcurveData.length; i += 2 ) {
					wave.append( ivcurveData[ i ], ivcurveData[ i + 1 ] );	
				}

				await delay( 5000 ); // Post j-V curve re-equilibration.
				this.preventMPPT[ chanId ] = false;
				return wave;
			} );
	}


	requestIVCurve( chanId ) {
		
		return this.query( globalConfig.trackerControllers.specialcommands.iv.execute( chanId ), 1 );
	}
	


	requestIVCurvePolling( chanId ) {
		
		return this.query( globalConfig.trackerControllers.specialcommands.iv.status, 2 ).then( ( data ) => {

			data = parseInt( data );
			if( data >= 1 ) {
				return true;
			}
			return false;
		});
	}

	requestIVCurveData( chanId ) {
		
		return this.query( globalConfig.trackerControllers.specialcommands.iv.data, 2 ).then( ( data ) => {

			data = data.replace('"', '').replace('"', '')
				.split(',');			
			data.pop();

			return data.map( ( value ) => parseFloat( value ) );
		});
	}
	



	//////////////////////////////////////
	// END IV CURVES
	//////////////////////////////////////




	//////////////////////////////////////
	// TRACK DATA
	//////////////////////////////////////


	_getTrackData( chanId ) {

		return this.query( globalConfig.trackerControllers.specialcommands.getTrackData( chanId ), 2, () => {

			return this.getStatus( chanId ).enable && this.getStatus( chanId ).tracking_mode

		}, false, true, 38 ).then( ( data ) => { 

			try {
				// data is buffer
				let out = [];
				for( var i = 0; i < 9; i ++ ) {
					out.push( data.readFloatLE( i * 4 ) ); // New float every 4 byte
				}
				
				out.push( data.readUInt8( 9 * 4 ) ); // Byte 32 has data
				out.push( data.readUInt8( 9 * 4 + 1 ) ); // Byte 33 has data
		
				return out; 
			} catch( e ) {
				console.log( data );
				console.log( e );
			}
			
		} ); // Ask for raw output
	}


	async getTrackDataInterval( chanId ) {

		const status 		= this.getStatus( chanId );
		const group 		= this.getGroupFromChanId( chanId );

		if( this.preventMPPT[ chanId ] ) {
			return;
		}

		const data = await this._getTrackData( chanId );
		let temperature;

		if( this.temperatures[ group.groupName ] && this.temperatures[ group.groupName ][ chanId ] ) {
			temperature = this.temperatures[ group.groupName ][ chanId ];
		}

		const voltageMean = parseFloat( data[ 0 ] ),
			currentMean = parseFloat( data[ 1 ] ),
			powerMean = parseFloat( data[ 2 ] ),
			voltageMin = parseFloat( data[ 3 ] ),
			currentMin = parseFloat( data[ 4 ] ),
			powerMin = parseFloat( data[ 5 ] ),
			voltageMax = parseFloat( data[ 6 ] ),
			currentMax = parseFloat( data[ 7 ] ),
			powerMax = parseFloat( data[ 8 ] ),
			nb = parseFloat( data[ 9 ] ),
			pga = parseFloat( data[ 10 ] );

		if( nb == 0 ) {
			console.warn( "No points collected for chan " + chanId, nb );
			return;
		}

		//results[9] in sun (1 / 1000 W m^-2)
		// powerMean in watt

		

		
		const lightChannel 	= group.light.channelId;
		const sun 			= await this.getChannelLightIntensity( chanId );
		//const sun = 1;

		const efficiency 	= ( powerMean / ( status.cellArea / 10000 ) ) / ( sun * 1000 ) * 100;

		if( isNaN( efficiency ) || !isFinite( efficiency ) ) {
			console.error("Efficiency has the wrong format. Check lightRef value: " + sun );
			return;
		}

		wsconnection.send( {

			instrumentId: this.getInstrumentId(),
			chanId: chanId,

			state: {
				voltage: voltageMean,
				current: currentMean,
				power: powerMean,
				efficiency: efficiency,
				sun: sun,
				temperature: temperature ? temperature[ 1 ] : -1,
				temperature_junction: temperature ? temperature[ 0 ] : -1,
				humidity: this.groupHumidity[ group.groupName ] || -1
			},

			action: {
				data: efficiency
			},

			timer: {
				iv: this.getTimerNext( 'iv', chanId ),
				voc: this.getTimerNext( 'voc', chanId ),
				jsc: this.getTimerNext( 'jsc', chanId ),
				aquisition: 0,
				ellapsed: Date.now() - measurements[ status.measurementName ].startDate
			}

		} );

		this.trackData.push( 
			{
			  chanId: chanId,
			  influx: {
		        measurement: encodeURIComponent( status.measurementName ),
		        timestamp: Date.now() * 1000000, // nano seconds
		        fields: { 
		          voltage_min: voltageMin,
		          voltage_mean: voltageMean,
		          voltage_max: voltageMax,
		          current_min: currentMin,
		          current_mean: currentMean,
		          current_max: currentMax,
		          power_min: powerMin,
		          power_mean: powerMean,
		          power_max: powerMax,
		          efficiency: efficiency,
		          sun: sun,
		          pga: pga,
				  temperature_base: temperature && !isNaN( temperature[ 1 ] ) ? temperature[ 1 ] : 0,
				  temperature_junction: temperature && !isNaN( temperature[ 0 ] ) ? temperature[ 0 ] : 0,
				  humidity: this.groupHumidity[ group.groupName ] || 0
		        }
		      }
			}
    	);
	}

	async measureVoc( chanId, extend ) {

		this
			.getStateManager()
			.addQuery( async () => {


				const status = this.getStatus( chanId );
				// Save the current mode
				const statusSaved = status.tracking_mode,	
					intervalSaved = status.tracking_interval,
					gainSaved = status.tracking_gain;

				this.preventMPPT[ chanId ] = true;

				// Change the mode to Voc tracking, with low interval
				// Update the cell status. Wait for it to be done
				
				await this.query( globalConfig.trackerControllers.specialcommands.voc.trigger( chanId ) );
				
				while( await this.query( globalConfig.trackerControllers.specialcommands.voc.status( chanId ), 2 ) == '1' ) {
					await delay( 1000 ); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
				}

				let voc = await this.query( globalConfig.trackerControllers.specialcommands.voc.data( chanId ), 2 ).then( val => parseFloat( val ) );
				
				await influx.storeVoc( status.measurementName, voc );

				wsconnection.send( {

					instrumentId: this.getInstrumentId(),
					chanId: chanId,
					state: {
						voc: voc
					},

					timer: {
						voc: this.getTimerNext( 'voc', chanId )
					}

				} );

				await delay( 5000 ); // Re equilibration
				this.preventMPPT[ chanId ] = false;
			} );
	}






	async measureJsc( chanId, extend ) {

		

		this
			.getStateManager()
			.addQuery( async () => {


				const status = this.getStatus( chanId );
				// Save the current mode
				const statusSaved = status.tracking_mode,	
					intervalSaved = status.tracking_interval,
					gainSaved = status.tracking_gain;

				this.preventMPPT[ chanId ] = true;

				// Change the mode to Voc tracking, with low interval
				// Update the cell status. Wait for it to be done
				
				await this.query( globalConfig.trackerControllers.specialcommands.jsc.trigger( chanId ) );
				
				while( await this.query( globalConfig.trackerControllers.specialcommands.jsc.status( chanId ), 2 ) == '1' ) {
					await delay( 1000 ); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
				}

				let jsc = await this.query( globalConfig.trackerControllers.specialcommands.jsc.data( chanId ), 2 ).then( val => parseFloat( val ) );
				
				await influx.storeJsc( status.measurementName, jsc );

				wsconnection.send( {

					instrumentId: this.getInstrumentId(),
					chanId: chanId,
					state: {
						jsc: jsc // in mA (not normalized by area)
					},

					timer: {
						jsc: this.getTimerNext( 'jsc', chanId )
					}


				} );

				await delay( 5000 ); // Re equilibration
				this.preventMPPT[ chanId ] = false;
			} );
	}


	lookupChanId( chanNumber ) {
		return chanNumber;
		/*if( this.getInstrumentConfig().channelLookup[ chanNumber ] ) {
			return this.getInstrumentConfig().channelLookup[ chanNumber ]
		}*/
	}



}

/*



function openConnections() {

	return globalConfig.trackerControllers.instruments.map( ( instrumentConfig ) => {

			
	} );
}


async function requestTemperature( instrumentId, channelId ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;
		return comm.lease = query( instrumentId, "DATA:TEMPERATURE:CH" + instrumentId );
	} );
}



async function requestHumidity( instrumentId ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;
		return comm.lease = query( instrumentId, "DATA:HUMIDITY" );
	} );
}*/


function possibleNewMeasurement( measurementName, status ) {

	if( ! measurements[ measurementName ] ) {
		measurements[ measurementName ] = {
			cellInfo: {
				cellName: status.cellName,
				cellArea: status.cellArea
			},
			startDate: Date.now()
		};

		fs.writeFileSync("./trackercontroller/measurements.json", JSON.stringify( measurements, undefined, "\t" ) );
		return Date.now();
	}

	return -1;
}


function measurementEnd( measurementName ) {

	if( measurements[ measurementName ] ) {
		
		measurements[ measurementName ].endDate = Date.now();
		fs.writeFileSync("./trackercontroller/measurements.json", JSON.stringify( measurements, undefined, "\t" ) );
	}
}

/**
 *	Verifies if a collection of objects has changed between two states
 *	@param { Array } objectCollection - An iterable object describing the elements to check
 *	@param { Object } ...states - A list of states objects which key may include the items in objectCollection
 *	@return { Boolean } - true if the state has changed, false otherwise
 */
function _hasChanged( objectCollection, ...states ) {

	var changed = false;
	objectCollection.forEach( ( el ) => {

		let stateRef;
		states.forEach( ( state, index ) => {

			if( index == 0 ) {

				stateRef = state[ el ];

			} else {

				if(stateRef === undefined || state[ el ] === undefined ||  stateRef !== state[el] ) {
					changed = true;
				}
			}
		});
	});

	return changed;
}

function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}

module.exports = TrackerController;