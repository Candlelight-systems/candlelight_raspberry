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
	
	return 	fs.writeFileSync(
			"matahari/status.json", 
			JSON.stringify( { channels: status }, undefined, "\t" ) 
		);
}


class TrackerInstrument extends InstrumentController {

	constructor( config ) {

		super( ...arguments );

		
		this._initLightControllers();

		this.preventMPPT = {};
		this.pdIntensity = {};

		this.cancelTimer = {};

		this.openConnection().then( async () => {
			
			await this.query( "RESERVED:SETUP" );
			await this.normalizeStatus();
			await this.scheduleLightReading( 10000 );

		} ).catch( ( e ) => {
			
			console.warn( e );
			// This is only once. Do not throw a reconnect here.
//			this.waitAndReconnect();
		
		});
	}

	kill() {

		this.lightControllers.forEach( ( controller ) => {
			controller.kill();
		});

		super.kill();
	}



	/**
	 *	Writes a command to the instrument, and adds a trailing EOL
	 *	@param {String} command - The command string to send
	 */
	query( command, lines = 1 ) {

		if( ! this.open ) {
			throw "Cannot write the instrument. The instrument communication is closed."
		}

		return super.query( command, lines );
	}



	/**
	 *	Upload the default status of the state
	 */
	async normalizeStatus() {

		let instrumentId = this.getConfig().instrumentId, 
			chanId;

		for( var j = 0, l = this.getConfig().channels.length; j < l; j ++ ) {

			chanId = this.getConfig().channels[ j ].chanId;

			if( ! this.statusExists( chanId ) ) {

				status.push( Object.assign( {}, defaultProps, {
					chanId: chanId,
					instrumentId: instrumentId
				} ) );

				await this.updateInstrumentStatusChanId( chanId, {}, true );
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
		
		for( var i = 0; i < status.length; i ++ ) {

			if( status[ i ].chanId == chanId && status[ i ].instrumentId == this.getInstrumentId() ) {

				return status[ i ];
			}
		}

		console.trace();
		throw "No channel associated with this chanId (" + chanId + ")";
	}

	/**
	 *	@returns whether the status of a particular channel exists
	 */
	statusExists( chanId ) {
		
		try {

			getStatus();
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
		return this.query( matahariconfig.specialcommands.pauseHardware );
	}


	async resumeChannels() {
		
		return this.query( matahariconfig.specialcommands.resumeHardware );
	}



	getChannels() {

		return this.getConfig().channels.map( 

			( chan ) => { 

				chan.instrumentId = this.getInstrumentId(); 
				chan.busy = this.isBusy( chan.chanId ); 
				return chan; 
			}
		)
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


	async resetStatus( chanId ) {
		this.saveStatus( chanId, defaultProps );
	}

	setVoltage( chanId, voltageValue ) {

		return this.query( matahariconfig.specialcommands.setVoltage( chanId, voltageValue ) );
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

		// IV start point
		this._setStatus( chanId, "iv_start", parseFloat( newStatus.iv_start ), newStatus );	

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
		this._setStatus( chanId, "cellArea", newStatus.cellArea, newStatus );
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

		for( var i = 0; i < status.length; i ++ ) {

			if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {

				status[ i ][ paramName ] = paramValue;
			}
		}

		if( save ) {
			saveStatus();
		}
	}


	async updateInstrumentStatusChanId( chanId, previousState = {}, force = false ) {

		let instrumentId = this.getInstrumentId(),
			status = this.getStatus( chanId ),
			comm = this.getConnection();


		if( status.enable == 0 ) {
			
			this.removeTimer( "track", chanId );
			this.removeTimer( "voc", chanId );
			this.removeTimer( "jsc", chanId );
			this.removeTimer( "iv", chanId );
		}

		await this.pauseChannels();

		for( let cmd of matahariconfig.statuscommands ) {

			if( !force && ( cmd[ 1 ]( status ) === cmd[ 1 ]( previousState ) ) ) {
				continue;
			}

			await this.query( cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( status ) );
		}

		await this.resumeChannels();

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


	getLightIntensity( lightRef ) {

		return this.pdIntensity[ lightRef ];
	}
	
	getLightFromChannel( chanId ) {

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
	}

	scheduleLightReading( interval ) {

		//if( this.timerExists( "pd" ) ) {
			this.setTimer("pd", undefined, this.measurePD, interval );
		//} 
	}

	async measurePD( ref ) {

		if( ! ref ) {
			for( var i = 0, l = this.config.pdRefs.length; i < l; i ++ ) {
				await this._measurePD( this.config.pdRefs[ i ].ref );		
			}
			return;
		}

		return await this._measurePD( ref );		
	}

	async _measurePD( ref ) {
		return this.pdIntensity[ ref ] = parseFloat( await this.query( matahariconfig.specialcommands.readPD[ ref ], 2 ) );
	}

	getPDOptions() {
		return this.config.pdRefs;
	}

	getPDData( ref ) {
		for( var i = 0, l = this.config.pdRefs.length; i < l; i ++ ) {
			if( ref == this.config.pdRefs[ i ].ref ) {
				return this.config.pdRefs[ i ];
			}
		}
	}

	getPDValue( ref ) {

		console.log( this.pdIntensity );
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

		this.lightControllers = [];

		if( this.config.lightControllers && Array.isArray( this.config.lightControllers ) ) {
		
			for( var i = 0; i < this.config.lightControllers.length; i ++ ) {
				let controller = new LightController( this.config.lightControllers[ i ] );
				controller.setTracker( this );
				this.lightControllers.push( controller );
			}
		}
	}


	async getLightControllers() {
		return this.config.lightControllers;
	}

	saveLightControllers( controllers ) {

console.log( controllers );
		for( var ref in controllers ) {

			for( var i = 0; i < this.config.lightControllers.length; i ++ ) {

				if( this.config.lightControllers[ i ].ref == ref ) {

					this.config.lightControllers[ i ].setPoint = controllers[ ref ].setPoint;
					this.config.lightControllers[ i ].scheduling.basis = controllers[ ref ].schedulingBasis;
					this.config.lightControllers[ i ].scheduling.intensities = controllers[ ref ].schedulingValues;
				}
			}
		}
	}


	//////////////////////////////////////
	// IV CURVES
	//////////////////////////////////////

	setTimer( timerName, chanId, callback, interval ) {

		

		// Let's set another time
		const intervalId = this.getIntervalName( timerName, chanId );

		this.cancelTimer[ intervalId ] = false;

		callback = callback.bind( this );

		if( intervals[ intervalId ] ) {
			clearTimeout( intervals[ intervalId ] );
		}

		intervals[ intervalId ] = setTimeout( async () => {

			try {
				
				await callback( chanId ); // This must not fail !
			
			} catch( e ) {

				console.warn( e );
				//throw( e );

			} finally { // If it does, restart the timer anyway

				if( this.cancelTimer[ intervalId ] ) {

					this.cancelTimer[ intervalId ] = false;
					return;
				}

				this.setTimer( timerName, chanId, callback, interval );	
			}

		}, interval );
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

		clearTimeout( this.getTimer( timerName, chanId ) );
		this.cancelTimer[ this.getIntervalName( timerName, chanId ) ] = true;
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

				await this.requestIVCurve( chanId );
				let i = 0;

				while( true ) {
					i++;
					
					var ivstatus = parseInt( await this.requestIVCurveStatus( chanId ) );
					
					if( ivstatus == 0 ) { // Once the curve is done, let's validate it
						break;
					}
					if( i > 100 ) { // Problem. 
						console.error("There has been a problem with getting the iv curve");
						break;
					}
					await delay( 1000 ); // Poling every second to see if IV curve is done
				}


				let ivcurveData = await this.requestIVCurveData( chanId );
				influx.storeIV( status.measurementName, ivcurveData );					
				//this.setTimer( timerName, chanId, callback, interval );

				await delay( 5000 ); // Re equilibration

				this.preventMPPT[ chanId ] = false;
				this._setStatus( chanId, 'iv_booked', false, undefined, true );


				const wave = new waveform();

				for( i = 0; i < ivcurveData.length; i += 2 ) {
					wave.append( ivcurveData[ i ], ivcurveData[ i + 1 ] );	
				}
				
				return wave;

			} );
	}


	requestIVCurve( chanId ) {
		
		return this.query( matahariconfig.specialcommands.executeIV + ":CH" + chanId );
	}
	

	requestIVCurveStatus( chanId ) {

		return this.query( matahariconfig.specialcommands.getIVStatus( chanId ), 2 );
	}

	requestIVCurveData( chanId ) {

		return this.query( matahariconfig.specialcommands.getIVData, 2 ).then( ( data ) => {

			data = data
				.split(',');


			data.pop()
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
			nb = parseInt( data[ 10 ] );

		if( parseInt( nb ) == 0 ) {
			return;
		}

		//results[9] in sun
		// W cm-2

		const lightRef = this.getLightFromChannel( chanId ); // In sun
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
			efficiency: efficiency/*,
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
					intervalSaved = status.tracking_interval;

				this.preventMPPT[ chanId ] = true;

				// Change the mode to Voc tracking, with low interval
				// Update the cell status. Wait for it to be done
				await this.saveStatus( chanId, { tracking_mode: 2, tracking_interval: 10 } );
				
				await delay( status.tracking_measure_voc_time ); // Go towards the Voc

				let trackingData = await this._getTrackData( chanId );
				const voc = trackingData[ 0 ];

				
				await influx.storeVoc( status.measurementName, voc );

				// Set back the tracking mode to the previous one
				// Update the channel. Make it synchronous.
				await this.saveStatus( chanId, { tracking_mode: statusSaved, tracking_interval: intervalSaved } );

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