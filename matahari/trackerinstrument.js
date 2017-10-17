'use strict';

let status 							= require("./status.json").channels;
let influx 							= require("./influxhandler");

const globalConfig					= require("../config");

const InstrumentController			= require("../instrumentcontroller");
const LightController				= require("../lightcontroller/lightcontroller");

const waveform						= require("jsgraph-waveform");

const matahariconfig = globalConfig.matahari;
const fs = require("fs");

const defaultProps = matahariconfig.defaults;

let connections = {};
let intervals = {};




function saveStatus() {
	
	return fs.writeFileSync(
			"matahari/status.json", 
			JSON.stringify( { channels: status }, undefined, "\t" ) 
		);
}


class TrackerInstrument extends InstrumentController {

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

		this.paused = false;

		this.openConnection( async () => {

			await this.pauseChannels();
			await this.query( "RESERVED:SETUP" );
			await this.normalizeStatus();
			await this.resumeChannels();
			await this.scheduleEnvironmentSensing( 10000 );

			// This will take some time as all channels have to be updated
			this._initLightControllers();

		});
	}	

	kill() {

		for( let controller of this.lightControllers ) {
			controller.kill();
		}

		super.kill();
	}

	getGroupFromChanId( chanId ) {

		const cfg = this.getConfig();

		for( var i = 0; i < cfg.groups.length; i ++ ) {

			for( var j = 0; j < cfg.groups[ i ].channels.length; j ++ ) {

				if( cfg.groups[ i ].channels[ j ].chanId == chanId ) {

					return cfg.groups[ i ];
				}
			}
		}
	}

	getGroupFromGroupName( groupName ) {

		const cfg = this.getConfig();

		for( var i = 0; i < cfg.groups.length; i ++ ) {

			if( cfg.groups[ i ].groupName == groupName ) {

				return cfg.groups[ i ];
			}
		}

		throw "Cannot find the group with group name " + groupName;
	}

	getConfig( groupName, chanId ) {

		if( groupName === undefined && chanId === undefined ) {
			return super.getConfig();
		}

		const cfg = this.getConfig();

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
	query( command, lines = 1, prepend = false ) {
	
		if( ! this.open ) {
			console.trace();
			throw "Cannot write command \"" + command + "\" to the instrument. The instrument communication is closed."
		}

		return super.query( command, lines, prepend );
	}



	/**
	 *	Upload the default status of the state
	 */
	async normalizeStatus() {

		const cfg = this.getConfig(),
			  groups = cfg.groups;

		let instrumentId = cfg.instrumentId, 
			chanId;

		for( var i = 0, m = groups.length; i < m ; i ++ ) {
		
			for( var j = 0, l = groups[ i ].channels.length; j < l; j ++ ) {

				chanId = groups[ i ].channels[ j ].chanId;

				if( ! this.statusExists( chanId ) ) {

					status.push( Object.assign( {}, defaultProps, {
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
		return this.getConfig().instrumentId;
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

		return this.query( matahariconfig.specialcommands.pauseHardware, 1, true ).then( () => {
			this.paused = true;
		});
	}


	async resumeChannels() {
		
		return this.query( matahariconfig.specialcommands.resumeHardware, 1, true ).then( () => {
			this.paused = false;
		});
	}



	getGroups() {

		return this.getConfig().groups;/*.map( ( group ) => { 

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

		for( let group of this.getConfig().groups ) {

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

		return this.query( matahariconfig.specialcommands.setVoltage( chanId, voltageValue ) );
	}


	async resetStatus( chanId ) {

		let index = this.getStatusIndex( chanId );
		this.saveStatus( chanId, defaultProps );
		status[ index ] = Object.assign( {}, defaultProps, { chanId: chanId, instrumentId: this.getInstrumentId() } );

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

		this._setStatus( chanId, "enable", newStatus.enable ? 1 : 0, newStatus );

	

		
		// Updates the stuff unrelated to the tracking

		this._setStatus( chanId, "measurementName", newStatus.measurementName, newStatus );
		this._setStatus( chanId, "cellName", newStatus.cellName, newStatus );
		this._setStatus( chanId, "cellArea", parseFloat( newStatus.cellArea ), newStatus );
		this._setStatus( chanId, "lightRef", newStatus.lightRef, newStatus );
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
		await this.updateInstrumentStatusChanId( chanId, previousStatus );

		if( ! noSave ) {
			saveStatus();
		}
	}

	enableChannel( chanId ) {
		return this.saveStatus( chanId, { enable: true } );
	}

	disableChannel( chanId ) {
		return this.saveStatus( chanId, { enable: false } );
	}

	measureCurrent( chanId ) {
		return this.query( matahariconfig.specialcommands.measureCurrent( chanId ), 2 ).then( ( current ) => parseFloat( current ) );
	}

	_setStatus( chanId, paramName, paramValue, newStatus, save ) {

		let instrumentId = this.getInstrumentId();

		if( newStatus && ! newStatus.hasOwnProperty( paramName ) ) {
			return;
		}

		if( ! this.statusExists( chanId ) ) {
			status.push = {
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

		for( let cmd of matahariconfig.statuscommands ) {

			if( !force && ( cmd[ 1 ]( status ) === cmd[ 1 ]( previousState ) ) ) {
				continue;
			}

			await this.query( cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( status ), 1, true );
		}

		if( pauseChannels ) {
			await this.resumeChannels();	
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


console.log( status );

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

		let groups = this.getConfig().groups;
		let temperature, lights, humidity;

		for( var i = 0, l = groups.length; i < l; i ++ ) {
				
			await influx.storeEnvironment( 
				this.getInstrumentId() + "_" + groups[ i ].groupID,
				0, 0,//await this.measureGroupTemperature( groups[ i ].groupName ),
				//await this.measureGroupHumidity( groups[ i ].groupName ),
				await this.measureGroupLightIntensity( groups[ i ].groupName )
			);
			
		}
	}

	getLightIntensity( lightRef ) {

		return this.pdIntensity[ lightRef ];
	}
	
	getLightFromChannel( chanId ) {

		let group = this.getGroupFromChanId( chanId );

		return this.getLightIntensity( group.pds[ 0 ] );
		/*
		const { lightRef, lightRefValue } = this.getStatus( chanId );

		switch( lightRef ) {
			
			case 'pd_1':
			case 'pd_2':
				return this.getLightIntensity( lightRef );
 				break;

			default:
				return lightRefValue;
			break;
		}
		*/
	}

	async measureTemperature( chanId ) {

		let group = this.getGroupFromChanId( chanId );
		let chan = this.getConfig( group.groupName, chanId );

		if( ! chan.temperatureSensor ) {
			throw "No temperature sensor linked to channel " + chanId;
		}
		return;
		var baseTemperature = parseFloat( await this.query( matahariconfig.specialcommands.readTemperatureChannelBase( group.i2cSlave, chanId ), 2 ) );
		var sensorVoltage = parseFloat( await this.query( matahariconfig.specialcommands.readTemperatureChannelIR( group.i2cSlave, chanId ), 2 ) );
console.log( chanId, sensorVoltage );
		return this.temperatures[ chanId ] = [ baseTemperature, sensorVoltage, baseTemperature + ( ( sensorVoltage + chan.temperatureSensor.offset ) * chan.temperatureSensor.gain ) ].map( ( val ) => Math.round( val * 10 ) / 10 );
	}

	async measureGroupTemperature( groupName ) {

		let group = this.getGroupFromGroupName( groupName );
		this.groupTemperature[ groupName ] = Math.round( 10 * parseFloat( await this.query( matahariconfig.specialcommands.readTemperature( group.i2cSlave ), 2 ) ) ) / 10;
		return this.getGroupTemperature( groupName );
	}

	getGroupTemperature( groupName ) {

		return this.groupTemperature[ groupName ];
	}

	async measureGroupHumidity( groupName ) {

		let group = this.getGroupFromGroupName( groupName );
		this.groupHumidity[ groupName ] = Math.round( 1000 * parseFloat( await this.query( matahariconfig.specialcommands.readHumidity( group.i2cSlave ), 2 ) ) ) / 10 ;
		
		return this.getGroupHumidity( groupName );
	}

	getGroupHumidity( groupName ) {

		return this.groupHumidity[ groupName ];
	}


	async measureGroupLightIntensity( groupName ) {

		let group = this.getGroupFromGroupName( groupName ),
			vals = [];

		for( var i = 0, l = group.pds.length; i < l; i ++ ) {
			vals.push( await this._measurePD( group.pds[ i ] ) );
		}
console.log( vals );
		return vals;
	}

	async _measurePD( ref ) {
		if( ! matahariconfig.specialcommands.readPD[ ref ] ) {
			console.warn("Photodiode with reference " + ref + " doesn't have an associated command");
			return;
		}

		return this.pdIntensity[ ref ] = parseFloat( await this.query( matahariconfig.specialcommands.readPD[ ref ], 2 ) );
	}

	getPDOptions( groupName ) {

		
		let pdOptions = [];

		const group = this.getGroupFromGroupName( groupName );
		const pds = group.pds;
		
		if( ! pds ) {
			return [];
		}

		for( var i = 0, l = this.config.pdRefs.length; i < l; i ++ ) {
			if( pds.includes( this.config.pdRefs[ i ].ref ) ) {
				pdOptions.push( this.config.pdRefs[ i ] );
			}
		}

		return pdOptions;
	}

	getPDData( ref ) {
		for( var i = 0, l = this.config.pdRefs.length; i < l; i ++ ) {
			if( ref == this.config.pdRefs[ i ].ref ) {
				return this.config.pdRefs[ i ];
			}
		}
	}

	getPDValue( ref ) {
		return this.pdIntensity[ ref ];
	}


	async setPDScaling( pdRef, pdScale ) {
		for( var i = 0; i < this.config.pdRefs.length; i ++ ) {

			if( this.config.pdRefs[ i ].ref === pdRef ) {
				this.config.pdRefs[ i ].scaling_ma_to_sun = pdScale;	
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
		const groups = this.getConfig().groups;

		for( var i = 0; i < groups.length; i ++ ) {

			if( groups[ i ].lightController ) {

				let controller = new LightController( groups[ i ].lightController )
				controller.setTracker( this );
				this.lightControllers[ groups[ i ].groupName ] = controller;
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

	async saveLightController( groupName, controller ) {

		let controllerCfg = this.getLightControllerConfig( groupName );

		if( ! this.lightControllers || ! this.lightControllers[ groupName ] ) {
			return;
		}

		controllerCfg.setPoint = controller.setPoint;
		controllerCfg.scheduling.basis = controller.schedulingBasis;
		controllerCfg.scheduling.intensities = controller.schedulingValues;

		this.emptyQueryQueue();

		await this.lightControllers[ groupName ].setConfig( controllerCfg );	// Updates the config of the controller

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


	setTimer( timerName, chanId, callback, interval ) {

				// Let's set another time
		const intervalId = this.getIntervalName( timerName, chanId );

		callback = callback.bind( this );

		intervals[ intervalId ] = {

			interval: interval,
			chanId: chanId,
			lastTime: 0,
			activated: true,
			callback: callback
		}
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

				//this.setTimer( timerName, chanId, callback, interval );


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
		
		return this.query( matahariconfig.specialcommands.executeIV + ":CH" + chanId, 2 ).then( ( data ) => {
console.log( data );
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

		return this.query(  matahariconfig.specialcommands.getTrackData + ":CH" + chanId, 2, () => {

			return this.getStatus( chanId ).enable && this.getStatus( chanId ).tracking_mode

		} ).then( ( data ) => { return data.split(",") } );
	}

	async getTrackDataInterval( chanId ) {

		const status = this.getStatus( chanId );

		if( this.preventMPPT[ chanId ] ) {
			
			return;
		}

		const data = await this._getTrackData( chanId );
		const temperature = await this.measureTemperature( chanId );

		const voltageMean = parseFloat( data[ 0 ] ),
			currentMean = parseFloat( data[ 1 ] ),
			powerMean = parseFloat( data[ 2 ] ),
			voltageMin = parseFloat( data[ 3 ] ),
			currentMin = parseFloat( data[ 4 ] ),
			powerMin = parseFloat( data[ 5 ] ),
			voltageMax = parseFloat( data[ 6 ] ),
			currentMax = parseFloat( data[ 7 ] ),
			powerMax = parseFloat( data[ 8 ] ),
			sun = parseFloat( data[ 9 ] ),
			nb = parseInt( data[ 10 ] ),
			pga = parseInt( data[ 11 ] );

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

		await influx.storeTrack( status.measurementName, {

			voltageMean: voltageMean,
			currentMean: currentMean,
			powerMean: powerMean,
			voltageMin: voltageMin,
			currentMin: currentMin,
			powerMin: powerMin,
			voltageMax: voltageMax,
			currentMax: currentMax,
			powerMax: powerMax,
			sun: lightRef,
			efficiency: efficiency,
			pga: pga,
			temperature_base: temperature ? temperature[ 0 ] : 0,
			temperature_junction: temperature ? temperature[ 2 ] : 0,
			humidity: this.groupHumidity[ group.groupName ] || 0
			/*,
			temperature: EnvironmentalScheduler.getTemperature( status.chanId ),
			humidity: EnvironmentalScheduler.getHumidity( status.chanId )*/
		} );
	}

	async measureVoc( chanId ) {

		this._setStatus( chanId, 'voc_booked', true, undefined, true );

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
				await this.saveStatus( chanId, { tracking_mode: 2, tracking_interval: 10, tracking_gain: 128 } );
				
				await delay( status.tracking_measure_voc_time ); // Go towards the Voc

				let trackingData = await this._getTrackData( chanId );
				const voc = trackingData[ 0 ];

				
				await influx.storeVoc( status.measurementName, voc );

				// Set back the tracking mode to the previous one
				// Update the channel. Make it synchronous.
				await this.saveStatus( chanId, { tracking_mode: statusSaved, tracking_interval: intervalSaved, tracking_gain: gainSaved } );

				await delay( 5000 ); // Re equilibration

				this._setStatus( chanId, 'voc_booked', false, undefined, true );
				this.preventMPPT[ chanId ] = false;
			} );
	}



	async measureJsc( chanId ) {

		this._setStatus( chanId, 'jsc_booked', true, undefined, true );

		this
			.getStateManager()
			.addQuery( async () => {

				const status = this.getStatus( chanId );
				// Save the current mode
				const statusSaved = status.tracking_mode,	
					intervalSaved = status.tracking_interval;

				this.preventMPPT[ chanId ] = true;

				// Change the mode to Jsc tracking, with low interval
				// Update the cell status. Wait for it to be done
				await this.saveStatus( chanId, { tracking_mode: 3, tracking_interval: 10 } );
				
				await delay( status.tracking_measure_jsc_time ); // Equilibrate at jsc

				let trackingData = await this._getTrackData( chanId );
				const jsc = trackingData[ 1 ];

				await influx.storeJsc( status.measurementName, jsc );

								// Set back the tracking mode to the previous one
				// Update the channel. Make it synchronous.
				await this.saveStatus( chanId, { tracking_mode: statusSaved, tracking_interval: intervalSaved } );


				await delay( 5000 ); // Re equilibration

				this._setStatus( chanId, 'jsc_booked', false, undefined, true );
				this.preventMPPT[ chanId ] = false;
			} );
	}

}

/*



function openConnections() {

	return matahariconfig.instruments.map( ( instrumentConfig ) => {

			
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

module.exports = TrackerInstrument;