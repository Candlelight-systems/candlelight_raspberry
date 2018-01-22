'use strict';

const fs = require("fs");

let status 							= require("./status.json").channels;

let measurements					= require("./measurements.json");
const influx 						= require("./influxhandler");
const globalConfig					= require("../config");
const InstrumentController			= require("../instrumentcontroller");
const HostManager					= require("../hostmanager");
const LightController				= require("../lightcontroller/lightcontroller");
const waveform						= require("jsgraph-waveform");
const lightControllerMain			= require('../lightcontroller/main');
const wsconnection					= require('../wsconnection' );

let connections = {};
let intervals = {};

function saveStatus() {
	
	return fs.writeFileSync(
		"./trackercontroller/status.json", 
		JSON.stringify( { channels: status }, undefined, "\t" ) 
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

		this.preventMPPT = {};
		this.pdIntensity = {};

		this.checkStatusbyte = true;
		this.paused = false;
			
	}	

	init() {

		this.trackData = [];

		this.openConnection( async () => {

			this.configure();
		} );
	}

	async configure() {

		await this.pauseChannels();
		await this.query( "RESERVED:SETUP" );
		await this.normalizeStatus();
		await this.resumeChannels();
		await this.scheduleEnvironmentSensing( 10000 );

		// This will take some time as all channels have to be updated
		this._initLightControllers();
		this._initHeatControllers();
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
	query( command, lines = 1, executeBefore, prepend = false, rawOutput, expectedBytes ) {

		return super.query( command, lines, executeBefore, prepend, rawOutput, expectedBytes );
	}



	/**
	 *	Upload the default status of the state
	 */
	async normalizeStatus() {

		const cfg = this.getInstrumentConfig(),
			  groups = cfg.groups;

		let instrumentId = cfg.instrumentId, 
			chanId;

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

		return this.getInstrumentConfig().groups;/*.map( ( group ) => { 

			group.channels.map( ( channel ) => {

// We should check if this is legacy code ?

//				channel.instrumentId = this.getInstrumentId(); 
//				channel.busy = this.isBusy( channel.chanId ); 
				return channel; 

			} );

			return group;
		} );*/
	}

	getChannels( groupName = "" ) {

		for( let group of this.getInstrumentConfig().groups ) {

			if( group.groupName == groupName )  {

				return group.channels;
			}
		}

		return [];
	}



	/**
	 *	Checks if a channel is busy
	 *	@param {Number} chanId - The channel ID
	 *	@returns true if the relay is enabled and if the tracking mode is set to other than idle (0)
	 */
	isBusy( chanId ) {

		if( ! this.statusExists( chanId ) ) {
			return false;
		}
		
		let status = this.getStatus( chanId );

		return status.tracking_mode && status.enable == 1;
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
				update: true,
				stopped: true
			}
		} );
	}

	

	async resetStatuses( groupName ) {
		
		this.getChannels( groupName ).map( async ( c ) => {
			await this.resetStatus( c.chanId );
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

		// Step size
		this._setStatus( chanId, "tracking_switchdelay", Math.max( 0, parseFloat( newStatus.tracking_switchdelay ) ), newStatus );	

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


		if( newStatus.measurementName !== previousStatus.measurementName && newStatus.measurementName ) {
			possibleNewMeasurement( newStatus.measurementName, newStatus );
		}

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

	enableChannel( chanId, noIV ) {
		this.noIV = true;
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
			comm = this.getConnection();

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

			if( !force && ( cmd[ 1 ]( status ) === cmd[ 1 ]( previousState ) ) ) {
				continue;
			}

			await this.query( cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( status ), 1, undefined, true );
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

					if( this.noIV ) {
						this.noIV = false;
						return;
					}

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




	//////////////////////////////////////
	// LIGHT MANAGEMENT
	//////////////////////////////////////


	scheduleEnvironmentSensing( interval ) {

		//if( this.timerExists( "pd" ) ) {
			this.setTimer("env", undefined, this.measureEnvironment, interval );
		//} 
	}

	async measureEnvironment() {


		let groups = this.getInstrumentConfig().groups;
		let temperature, lights, humidity;

		for( let group of groups ) {
				
			let humidity = await this.measureGroupHumidityTemperature( group.groupName );
			
			let data = {
				temperature: humidity.temperature,
				humidity: humidity.humidity,
				paused: this.paused
			};

			if( group.lightController ) {

				let controllerConfig = this.getLightController( group.groupName ).getInstrumentConfig()[ group.groupName ];
				
				let controller = this.getLightController( group.groupName );
				Object.assign( data, {
					lightAutomatic: controllerConfig.modeAutomatic,
					lightSetpoint: controller.getSetPoint( group.groupName ),
					lightValue: await this.measureGroupLightIntensity( group.groupName ),
				} );
			}

			if( group.heatController ) {

				let controllerConfig = this.getHeatController( group.groupName ).getInstrumentConfig()[ group.groupName ];
				
				Object.assign( data, {
					heater_status: controllerConfig.on,
					heater_power: controllerConfig.value
				} );
			}

			wsconnection.send( {
				instrumentId: this.getInstrumentId(),
				groupName: group.groupName,
				data: data
			});
		}
	}

	getLightIntensity( lightRef ) {
		let cfg = this.getPDData( lightRef );
		return this.pdIntensity[ lightRef ] * cfg.scaling_ma_to_sun;
	}
	
	getLightFromChannel( chanId ) {

		const { connection, lightRefValue } = this.getStatus( chanId );
		
		if( connection == 'group' ) {
			return this.getLightIntensity( this.getGroupFromChanId( chanId ).pds[ 0 ] );
		}


		return lightRefValue / 1000; // Transform W m-2 into suns

	}

	async resetSlave() {
		return this.query( globalConfig.trackerControllers.specialcommands.resetSlave );

	}

	async measureTemperature( chanId ) {

		let group = this.getGroupFromChanId( chanId );
		let chan = this.getInstrumentConfig( group.groupName, chanId );

		if( ! chan.temperatureSensor ) {
			throw "No temperature sensor linked to channel " + chanId;
		}

		var baseTemperature = parseFloat( await this.query( globalConfig.trackerControllers.specialcommands.readTemperatureChannelBase( chan.temperatureSensor.channel ), 2 ) );
		var sensorVoltage = parseFloat( await this.query( globalConfig.trackerControllers.specialcommands.readTemperatureChannelIR( chan.temperatureSensor.channel ), 2 ) );
console.log( chan.temperatureSensor.channel, baseTemperature, sensorVoltage );
		return this.temperatures[ chanId ] = [ baseTemperature, sensorVoltage, baseTemperature + ( ( sensorVoltage + chan.temperatureSensor.offset ) * chan.temperatureSensor.gain ) ].map( ( val ) => Math.round( val * 10 ) / 10 ).concat( [ [ chan.temperatureSensor.offset, chan.temperatureSensor.gain ] ] );
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


	async measureGroupLightIntensity( groupName, scaling = true ) {

		let group = this.getGroupFromGroupName( groupName ),
			vals = [],
			cfg;

		for( var i = 0, l = group.pds.length; i < l; i ++ ) {
			cfg = this.getPDData( group.pds[ i ] );
			let pd = await this._measurePD( group.pds[ i ] ) ;
			
			vals.push( pd * ( scaling ? cfg.scaling_ma_to_sun : 1 ) );
			break;
		}

		return vals;
	}

	async _measurePD( ref ) {
		
		if ( globalConfig.trackerControllers.specialcommands.readPD[ ref ] ) {
			return this.pdIntensity[ ref ] = parseFloat( await this.query( globalConfig.trackerControllers.specialcommands.readPD[ ref ], 2 ) );
		}	
	}

	getPDOptions( groupName ) {

		
		let pdOptions = [];

		const group = this.getGroupFromGroupName( groupName );
		const pds = group.pds;
		
		if( ! pds ) {
			return [];
		}

		for( var i = 0, l = this.getInstrumentConfig().pdRefs.length; i < l; i ++ ) {
			if( pds.includes( this.getInstrumentConfig().pdRefs[ i ].ref ) ) {
				pdOptions.push( this.getInstrumentConfig().pdRefs[ i ] );
			}
		}

		return pdOptions[ 0 ];
	}

	getPDData( ref ) {
		for( var i = 0, l = this.getInstrumentConfig().pdRefs.length; i < l; i ++ ) {
			if( ref == this.getInstrumentConfig().pdRefs[ i ].ref ) {
				return this.getInstrumentConfig().pdRefs[ i ];
			}
		}
	}

	async setPDScaling( groupName, pdScale ) {

		const group = this.getGroupFromGroupName( groupName );
		const pds = group.pds;
		
		for( var i = 0; i < this.getInstrumentConfig().pdRefs.length; i ++ ) {

			if( this.getInstrumentConfig().pdRefs[ i ].ref === pds[ 0 ] ) {
				this.getInstrumentConfig().pdRefs[ i ].scaling_ma_to_sun = pdScale;	
			}
		}
	}

	//////////////////////////////////////
	// LIGHT MANAGER
	//////////////////////////////////////


	_initLightControllers() {

		if( this.lightControllers ) {
			return;
		}

		this.lightControllers = {};
		const groups = this.getInstrumentConfig().groups;

		for( var i = 0; i < groups.length; i ++ ) {

			if( groups[ i ].lightController ) {

				this.lightControllers[ groups[ i ].groupName ] = HostManager.getHost( groups[ i ].lightController );

				this.lightControllers[ groups[ i ].groupName ].setTracker( this, groups[ i ].groupName );

			}
		}
	}


	getLightControllerConfig( groupName ) {

		let group = this.getGroupFromGroupName( groupName );

		if( ! this.hasLightController( groupName ) ) {
			throw "No light controller for group with name \"" + groupName + "\"";
		}

		return group.lightController;
	}



	getLightController( groupName ) {

		if( ! this.hasLightController( groupName ) ) {
			throw "No light controller for group with name \"" + groupName + "\"";	
		}

		return this.lightControllers[ groupName ];
	}

	hasLightController( groupName ) {

		let group = this.getGroupFromGroupName( groupName );
		return  !! group.lightController && !! this.lightControllers && !! this.lightControllers[ groupName ];
	}

	_initHeatControllers() {

		if( this.heatControllers ) {
			return;
		}

		this.heatControllers = {};
		const groups = this.getInstrumentConfig().groups;

		for( var i = 0; i < groups.length; i ++ ) {

			if( groups[ i ].heatController ) {
				this.heatControllers[ groups[ i ].groupName ] = HostManager.getHost( groups[ i ].heatController );
				this.heatControllers[ groups[ i ].groupName ].setTracker( this, groups[ i ].groupName );
			}
		}
	}

	getHeatControllerConfig( groupName ) {
		let group = this.getGroupFromGroupName( groupName );
		if( ! this.hasHeatController( groupName ) ) {
			throw "No heat controller for group with name \"" + groupName + "\"";
		}
		return group.heatController;
	}

	getHeatController( groupName ) {
		if( ! this.hasHeatController( groupName ) ) {
			throw "No heat controller for group with name \"" + groupName + "\"";	
		}
		return this.heatControllers[ groupName ];
	}

	hasHeatController( groupName ) {
		let group = this.getGroupFromGroupName( groupName );
		return  !! group.heatController && !! this.heatControllers && !! this.heatControllers[ groupName ];
	}



	async saveLightController( groupName, cfg ) {

		if( ! this.lightControllers || ! this.lightControllers[ groupName ] ) {
			return;
		}

		let group = this.getGroupFromGroupName( groupName );

		this.emptyQueryQueue();
		await lightControllerMain.setGroupConfig( group.lightController, groupName, cfg ); // Updates the config of the controller
		await this.pauseChannels();
		await this.lightControllers[ groupName ].checkLightStatus( false );	// Force an update of the light controller
		await this.measureEnvironment(); // Wait until the new point is stored in influxDB
		await this.resumeChannels();


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

		if( ! Array.isArray( this.trackData ) || ! this.trackData ) {
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
			.getStateManager()
			.addQuery( async () => {

				var status = this.getStatus( chanId );

				this.preventMPPT[ chanId ] = true;

				if( ! status.enable ) {
					throw "Channel not enabled";
				}

				let ivcurveData = await this.requestIVCurve( chanId );
				influx.storeIV( status.measurementName, ivcurveData, this.getLightFromChannel( chanId ) );

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

				await delay( 5000 ); // Re equilibration
				return wave;
			} );
	}


	requestIVCurve( chanId ) {
		
		return this.query( globalConfig.trackerControllers.specialcommands.executeIV( chanId ), 2 ).then( ( data ) => {

			data = data
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

		const status = this.getStatus( chanId );

		if( this.preventMPPT[ chanId ] ) {
			return;
		}

		const data = await this._getTrackData( chanId );
		
		let temperature;

		try {
			temperature = await this.measureTemperature( chanId );
		} catch( e ) {
			temperature = [ -1, 0, -1, [ 0, 1 ] ];
		}
//console.log( temperature );
		//console.log( temperature[ 0 ], temperature[ 1 ] + temperature[ 3 ][ 0 ] );

		const voltageMean = parseFloat( data[ 0 ] ),
			currentMean = parseFloat( data[ 1 ] ),
			powerMean = parseFloat( data[ 2 ] ),
			voltageMin = parseFloat( data[ 3 ] ),
			currentMin = parseFloat( data[ 4 ] ),
			powerMin = parseFloat( data[ 5 ] ),
			voltageMax = parseFloat( data[ 6 ] ),
			currentMax = parseFloat( data[ 7 ] ),
			powerMax = parseFloat( data[ 8 ] ),
			//sun = parseFloat( data[ 9 ] ),
			nb = parseInt( data[ 9 ] ),
			pga = parseInt( data[ 10 ] );


		if( nb == 0 ) {
			return;
		}

		//results[9] in sun
		// W cm-2

		const lightRef = this.getLightFromChannel( chanId ); // In sun


		const group = this.getGroupFromChanId( chanId );

		let efficiency = ( powerMean / ( status.cellArea ) ) / ( lightRef * 0.1 ) * 100;

		if( isNaN( efficiency ) || !isFinite( efficiency ) ) {
			console.error("Efficiency has the wrong format. Check lightRef value: " + lightRef );
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
				sun: lightRef,
				temperature: temperature ? temperature[ 0 ] : -1,
				temperature_junction: temperature ? temperature[ 2 ] : -1,
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
		          sun: lightRef,
		          pga: pga,
				  temperature_base: temperature ? temperature[ 0 ] : 0,
				  temperature_junction: temperature ? temperature[ 2 ] : 0,
				  humidity: this.groupHumidity[ group.groupName ] || 0
		        }
		      }
			}
    	);
	}


	async measureVoc( chanId, extend ) {

		await this
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

		

		await this
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


	async setHeatingPower( groupName, power ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		await controller.setPower( groupName, power );
		await this.measureEnvironment();
	}



	async increaseHeatingPower( groupName ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		await controller.increasePower( groupName );
		await this.measureEnvironment();
		//throw `No heating controller associated to the group name ${ groupName }`;
	}


	async decreaseHeatingPower( groupName ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		await controller.decreasePower( groupName );
		await this.measureEnvironment();
	}


	getHeatingPower( groupName ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		return controller.getPower( groupName );
	}

	async enableHeatingPower( groupName ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		await controller.turnOn( groupName );
		await this.measureEnvironment();
	}

	async disableHeatingPower( groupName ) {

		const config = this.getInstrumentConfig( groupName );
		let controller = this.getHeatController( groupName );
		await controller.turnOff( groupName );
		await this.measureEnvironment();
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