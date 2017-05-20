'use strict';

let status = require("./status.json").channels;
let serialport = require("serialport");
let influx = require("influx");

const config = require("../config");
const MataHariIVScheduler = require("./ivscheduler");
const MataHariTrackScheduler = require("./trackscheduler");
const queryManager = require("./queryhandler");

const matahariconfig = config.matahari;
const fs = require("fs");

let connections = {};
Promise.all( openConnections() ).then( () => {
	normalizeStatus();
});


async function normalizeStatus() {	

	let instrumentId, chanId;

	let defaultProps = { 
		"tracking_record_interval": 1000,
		"tracking_interval": 100,
		"tracking_bwfwthreshold": 1,
		"tracking_fwbwthreshold": 1,
		"tracking_step": 1,
		"tracking_switchdelay": 1,
		"iv_start": 1,
		"iv_stop": 0,
		"iv_hysteresis": 0,
		"iv_rate": 0.1,
		"iv_interval": 24 * 3600 * 1000,
		"enable": 0,
		"tracking_measure_jsc": 0,
		"tracking_measure_voc": 0,
		"tracking_measure_jsc_time": 10000,
		"tracking_measure_voc_time": 10000,
		"tracking_measure_jsc_interval": 24 * 3600 * 1000,
		"tracking_measure_voc_interval": 24 * 3600 * 1000,
		"tracking_mode": 0,
		"cellArea": 0
	};

	for( var i = 0; i < matahariconfig.instruments.length; i ++ ) {

		for( var j = 0, l = matahariconfig.instruments[ i ].channels.length; j < l; j ++ ) {

			instrumentId = matahariconfig.instruments[ i ].instrumentId;
			chanId = matahariconfig.instruments[ i ].channels[ j ].chanId;

			if( ! getStatus( instrumentId, chanId ) ) {
				defaultProps.chanId = chanId;
				defaultProps.instrumentId = instrumentId;

				status.push( Object.assign( {}, defaultProps ) );
			}
		}

		filesaveStatus();
	}



	await pauseHardware( status[ i ].instrumentId );

	for( let i = 0; i < status.length; i++ ) {
		await updateInstrumentStatusChanId( status[ i ].instrumentId, status[ i ].chanId, [], true );
	}

	await resumeHardware( status[ i ].instrumentId );
}



function pauseHardware( instrumentId ) {
	return query( instrumentId, matahariconfig.specialcommands.pauseHardware );
}

function resumeHardware( instrumentId ) {
	return query( instrumentId, matahariconfig.specialcommands.resumeHardware );
}



function query( instrumentId, query ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		throw "Could not find communication based on the instrument id";
	}	

	return comm.queryManager.addQuery( async () => {

		await comm.lease;
		return comm.lease = new Promise( ( resolver, rejecter ) => {

			let data = "";
			comm.removeAllListeners( "data" );
			comm.on( "data", async ( d ) => {

				data += d.toString('ascii'); // SAMD sends ASCII data

				if( data.indexOf("\r\n") > -1 ) {
					comm.removeAllListeners( "data" );
					comm.flush();
					await delay( 100 );
					resolver( "ok" );
					return;
				}
			} );	
			
			comm.write( query + "\n" );
			comm.drain( );
		});
	});
}

function filesaveStatus() {
	
	return fs.writeFileSync("matahari/status.json", JSON.stringify( { channels: status }, undefined, "\t" ) );
}



function openConnections() {

	return matahariconfig.instruments.map( ( instrumentConfig ) => {

		return new Promise( ( resolver, rejecter ) => {

	
			const cfg = instrumentConfig.config;
			const connection = new serialport( cfg.host, cfg.params );

			connection.on("error", ( err ) => {
				throw "Error thrown by the serial communication: ", err;
			} );

			connection.on("open", () => {
				connection.flush();
				connection.write("RESERVED:REFENABLE\n");
				resolver();
			} );

			connection.on("close", ( ) => {

				setTimeout( () => {

					connection.open();

					updateAllInstrumentStatus( instrumentConfig.instrumentId );

				}, cfg.reconnectTimeout );
			} );

			connections[ instrumentConfig.instrumentId ] = connection;
			connections[ instrumentConfig.instrumentId ].lease = Promise.resolve();
			connections[ instrumentConfig.instrumentId ].queryManager = new queryManager( connection );
		} );	
	} );
		
}


function getChannels() {

	let chans = [];

	for( var i = 0; i < matahariconfig.instruments.length; i ++ ) {

		chans = chans.concat( 
			matahariconfig.instruments[ i ].channels.map( 
				( el ) => { el.instrumentId = matahariconfig.instruments[ i ].instrumentId; el.busy = isBusy( el.instrumentId, el.chanId ); return el; }
			)
		);
	}

	return chans;
}

function getStatus( instrumentId, chanId ) {
	
	for( var i = 0; i < status.length; i ++ ) {

		if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {

			return status[ i ];
		}
	}

	return false;
}

function isBusy( instrumentId, chanId ) {
	let status =  getStatus( instrumentId, chanId );

	if( ! status ) {
		return false;
	}

	return status.tracking_mode > 0 && status.enable == 1;
}

async function saveStatus( instrumentId, chanId, chanStatus ) {

	if( instrumentId === undefined || chanId === undefined ) {
		throw "Cannot set channels status";
	}

	let previousStatus = Object.assign( {}, getStatus( instrumentId, chanId ) );

	let originalStatus = getStatus( instrumentId, chanId );
	Object.assign( originalStatus, chanStatus );
	chanStatus = originalStatus;

	scheduleIVCurve( instrumentId, chanId, chanStatus.iv_interval );
	scheduleTracking( instrumentId, chanId, chanStatus.tracking_record_interval );

	setTrackingInterval(  instrumentId, chanId, chanStatus.tracking_interval );
	setTrackingBWFWThreshold( instrumentId, chanId, chanStatus.tracking_bwfwthreshold );
	setTrackingFWBWThreshold( instrumentId, chanId, chanStatus.tracking_fwbwthresholds );
	setTrackingStepSize( instrumentId, chanId, chanStatus.tracking_stepsize );
	setTrackingSwitchDelay( instrumentId, chanId, chanStatus.tracking_switchdelay );

	setIVStart( instrumentId, chanId, chanStatus.iv_start );
	setIVStop( instrumentId, chanId, chanStatus.iv_stop );
	setIVHysteresis( instrumentId, chanId, chanStatus.iv_hysteresis );
	setIVRate( instrumentId, chanId, chanStatus.iv_rate );

	if( chanStatus.enable ) {
		enableChannel( instrumentId, chanId );
	} else {
		disableChannel( instrumentId, chanId );
	}

	switch( chanStatus.tracking_mode ) {

		case 2:
			startChannelVoc( instrumentId, chanId, true );
		break;

		case 3:
			startChannelVoltage( instrumentId, chanId, true );
		break;

		case 1:
			startChannelMPP( instrumentId, chanId, true );
		break;

		case 0:
			stopChannel( instrumentId, chanId );
		break;
	}

	await updateInstrumentStatusChanId( instrumentId, chanId, previousStatus );
	return filesaveStatus();
}


function requestIVCurve( instrumentId, chanId, status ) {
	
	let comm = connections[ instrumentId ],
		data = "",
		data2;

	return comm.queryManager.addQuery( async ( ) => {
		
		await comm.lease;
		
		return comm.lease = new Promise( ( resolver, rejecter ) => {

			comm.removeAllListeners( "data" );
			comm.on( "data", async ( d ) => {

				data += d.toString('ascii'); // SAMD sends ASCII data

				if( data.indexOf("\r\n") > -1 ) {
					comm.removeAllListeners( "data" );
					comm.flush();
					await delay( 100 );
					
					resolver( "ok" );
					return;
				}
			} );	
			
			comm.write( matahariconfig.specialcommands.executeIV + ":CH" + chanId + "\n" );
			comm.drain();
		});
	});
}



function requestIVCurveStatus( instrumentId, chanId, status ) {

	let comm = connections[ instrumentId ],
		data = "",
		data2;

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;

		return comm.lease = new Promise( ( resolver, rejecter ) => {
			
			comm.removeAllListeners( "data" );
			
			let count = 0;
			comm.on( "data", async ( d ) => {

				data += d.toString('ascii'); // SAMD sends ASCII data

				while( data.indexOf("\r\n") > -1 ) {
					
					count++;
					
					if( count == 1 ) {
						data2 = parseInt( data.substr( 0, data.indexOf("\r\n") ) );
						data = data.substr( data.indexOf("\r\n") + 2 );
					}

					if( count >= 2 ) {
						comm.removeAllListeners( "data" );
						comm.flush();
						await delay( 100 );

						resolver( data2 );
						data = "";
						break;
					}
				}
			} );
			console.log( matahariconfig.specialcommands.getIVStatus + ":CH" + chanId + "\n" );
			comm.write( matahariconfig.specialcommands.getIVStatus + ":CH" + chanId + "\n" );
			comm.drain();
		});
	});
}


function requestIVCurveData( instrumentId, chanId, status ) {

	let comm = connections[ instrumentId ],
		data = "",
		data2;

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;
		
		return comm.lease = new Promise( ( resolver, rejecter ) => {
			
			comm.removeAllListeners( "data" );
			
			let count = 0;
			comm.on( "data", async ( d ) => {

				data += d.toString('ascii'); // SAMD sends ASCII data

				while( data.indexOf("\r\n") > -1 ) {
					
					count++;
					
					if( count == 1 ) {
						data2 = data.substr( 0, data.indexOf("\r\n") );
						data2 = data2.split(',');
						data = data.substr( data.indexOf("\r\n") + 2 );
					}

					if( count >= 2 ) {
						comm.removeAllListeners( "data" );
						comm.flush();
						await delay( 100 );

						resolver( data2 );
						data = "";
						break;
					}
				}
			} );
			
			comm.write( matahariconfig.specialcommands.getIVData + "\n" );
			comm.drain();
		});
	});
}


async function requestTrackingData( instrumentId, channelId ) {

	let comm = connections[ instrumentId ],
		data = "",
		data2;

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;

		return comm.lease = _requestTrackingData( comm, channelId );
	});

}


function _requestTrackingData( comm, channelId ) {

	let data = "",
		data2;

	return new Promise( ( resolver, rejecter ) => {

		comm.removeAllListeners( "data" );
		let count = 0;
		comm.on( "data", async ( d ) => {

			data += d.toString('ascii'); // SAMD sends ASCII data

			while( data.indexOf("\r\n") > -1 ) {
				
				count++;
				
				if( count == 1 ) {
					data2 = data.substr( 0, data.indexOf("\r\n") );
					data2 = data2.split(",");
					data = data.substr( data.indexOf("\r\n") + 2 );
				}

				if( count >= 2 ) {
					comm.removeAllListeners( "data" );
					comm.flush();
					await delay( 100 );
					resolver( data2 );
					data = "";
					break;
				}
			}
		} );	
		
		comm.write( matahariconfig.specialcommands.getTrackData + ":CH" + channelId + "\n" );
		comm.drain();
	});
}


async function requestVoc( instrumentId, channelId, status, onStart, equilibrationTime ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {
		
		await comm.lease;
		
		return comm.lease = new Promise( async ( resolver, rejecter ) => {

			// Save the current mode
			let statusSaved = status.tracking_mode,	
				intervalSaved = status.tracking_interval;

			// Change the mode to Voc tracking, with low interval
			status.tracking_mode = 2;
			status.tracking_interval = 10;

			// Update the cell status. Wait for it to be done
			await updateInstrumentStatusChanId( instrumentId, channelId );
			
			// Start counting
			setTimeout( async () => {

				let trackingData = await _requestTrackingData( comm, channelId ),
					voc = trackingData[ 0 ];

				// Set back the tracking mode to the previous one
				status.tracking_mode = statusSaved;
				status.tracking_interval = intervalSaved;

				// Update the channel. Make it synchronous.
				await updateInstrumentStatusChanId( instrumentId, channelId );

				// Make storage purely asynchronous (no need to wait on it)
			//	influx.storeVoc( status.measurementName, voc);

				// Delay before continuing
				await delay( 5000 );

				resolver( voc );

			}, equilibrationTime );
		} );
	} );
}




async function requestJsc( instrumentId, channelId, status, onStart, equilibrationTime ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {
		
		await comm.lease;
		
		return comm.lease = new Promise( async ( resolver, rejecter ) => {

			// Save the current mode
			let statusSaved = status.tracking_mode,	
				intervalSaved = status.tracking_interval;

			// Change the mode to Jsc tracking, with low interval
			status.tracking_mode = 3;
			status.tracking_interval = 10;

			// Update the cell status. Wait for it to be done
			await updateInstrumentStatusChanId( instrumentId, channelId );

			// Start counting
			setTimeout( async () => {

				let trackingData = await _requestTrackingData( comm, channelId ),
					jsc = trackingData[ 1 ];


				// Set back the tracking mode to the previous one
				status.tracking_mode = statusSaved;
				status.tracking_interval = intervalSaved;

				// Update the channel. Make it synchronous.
				await updateInstrumentStatusChanId( instrumentId, channelId );

				// Make storage purely asynchronous (no need to wait on it)
//				influx.storeJsc( status.measurementName, jsc );

				// Delay before continuing
				await delay( 5000 );

				resolver( jsc );

			}, equilibrationTime );
		} );
	} );
}


function getChanIdFromName( instrumentId, channelName ) {

	if( matahariconfig.instruments[ instrumentId ] && Array.isArray( matahariconfig.instruments[ instrumentId ] ) ) {

		for( var i = 0, l = matahariconfig.instruments[ instrumentId ].length; i < l; i ++ ) {

			if( matahariconfig.instruments[ instrumentId ][ i ].chanName == channelName ) {
				return matahariconfig.instruments[ instrumentId ][ i ].chanId;
			}
		}
	}
}

async function updateInstrumentStatusChanName( instrumentId, channelName ) {

	let chanId = getChanIdFromName( instrumentId, channelName );

	return updateInstrumentStatusChanId( instrumentId, chanId );
}


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

	if( changed ) {
		return true;
	}

	return false;
}

async function updateInstrumentStatusChanId( instrumentId, chanId, previousStatus = [], force = false ) {

	if( ! chanId ) {
		throw "Could not find channel id in config file based on the channel name";
	}

	for( var i = 0; i < status.length; i ++ ) {
		if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {
			break;
		}		
	}

	let chanStatus = status[ i ];

	if( ! status ) {
		throw "Could not find channel id in status config";
	}

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		throw "Could not find communication based on the instrument id";
	}	

	comm.queryManager.addQuery( async () => {

		await comm.lease;
		return comm.lease = new Promise( async ( resolver ) => {
			
			await delay( 100 ); // Allow some buffering time	

			for( let cmd of matahariconfig.statuscommands ) {
				
				await new Promise( async ( resolver ) => {

					if( !force && (previousStatus && cmd[ 1 ]( chanStatus ) === cmd[ 1 ]( previousStatus) ) ) {
						return resolver();
					}

					let command = cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( chanStatus ) + "\n",
						data = "";
					
					comm.on( "data", async ( d ) => {

						data += d.toString('ascii'); // SAMD sends ASCII data
						if( data.indexOf("\n") > -1 ) {
							comm.removeAllListeners( "data" );
							comm.flush();
							data = "";	
							await delay( 100 ); // Allow some buffering time	
							resolver();
						}
					} );

					if( comm.isOpen() ) {
						comm.write( command );
						
					}

					comm.once("open", async () => {
						comm.write( command );
						comm.drain();
					} );
				} );
			}

			// Handle IV scheduling
			if( ( ( ! MataHariIVScheduler.hasTimeout( instrumentId, chanId ) && ( chanStatus.iv_interval > 0 && chanStatus.iv_interval !== null && chanStatus.iv_interval !== undefined ) ) || _hasChanged( [ "iv_interval" ], chanStatus, previousStatus ) ) && chanStatus.enable > 0 ) {
				MataHariIVScheduler.schedule( instrumentId, chanId, chanStatus );
			}
			
			if( ! MataHariTrackScheduler.hasTimeout( "mpp", instrumentId, chanId ) || _hasChanged( [ "enabled", "tracking_mode", "tracking_record_interval"], chanStatus, previousStatus ) && chanStatus.enable > 0 && chanStatus.tracking_mode > 0 && chanStatus.tracking_record_interval > 0 &&  chanStatus.tracking_record_interval !== null && chanStatus.tracking_record_interval !== undefined ) {
				MataHariTrackScheduler.schedule( instrumentId, chanId, chanStatus );
			}

			// Scheduling Voc. Checks for applicability are done later
			if( ! MataHariTrackScheduler.hasTimeout( "voc", instrumentId, chanId ) || _hasChanged( [ "enabled", "tracking_measure_voc", "tracking_measure_voc_interval"], chanStatus, previousStatus ) ) {
				MataHariTrackScheduler.scheduleVoc( instrumentId, chanId, chanStatus );
			}

			// Scheduling Jsc. Checks for applicability are done later
			if( ! MataHariTrackScheduler.hasTimeout( "jsc", instrumentId, chanId ) || _hasChanged( [ "enabled", "tracking_measure_jsc", "tracking_measure_jsc_interval"], chanStatus, previousStatus ) ) {
				MataHariTrackScheduler.scheduleJsc( instrumentId, chanId, chanStatus );
			}

			if( chanStatus.enable == 0 ) {
				MataHariTrackScheduler.unschedule( instrumentId, chanId, chanStatus );
				MataHariIVScheduler.unschedule( instrumentId, chanId, chanStatus );
			}

			resolver();
		} );
	} );
}


async function updateAllInstrumentStatus( instrumentId ) {

	let config = matahariconfig.instruments[ instrumentId ];

	if( ! config ) {
		throw "Could not find the configuration file based on the instrument id";
	}

	for( var i = 0, l = config.length; i < l; i ++ ) {

		await updateStatusChanId( instrumentId, config[ i ].chanId );
	}
}

async function updateAllStatus() {

	let config = matahariconfig.instruments;

	for( var i in config ) {

		await updateAllInstrumentStatus( i );
	}
}

function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}


function setStatus( instrumentId, chanId, paramName, paramValue ) {

	for( var i = 0; i < status.length; i ++ ) {

		if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {

			status[ i ][ paramName ] = paramValue;
		}
	}
}


function startChannelMPP( instrumentId, chanId, noEnable = false ) {
	setStatus( instrumentId, chanId, "tracking_mode", 1 );
	if( ! noEnable ) {
		setStatus( instrumentId, chanId, "enable", 1 );
	}
}

function startChannelVoc( instrumentId, chanId, noEnable = false ) {
	setStatus( instrumentId, chanId, "tracking_mode", 2 );
	if( ! noEnable ) {
		setStatus( instrumentId, chanId, "enable", 1 );
	}
}

function startChannelJsc( instrumentId, chanId, noEnable = false ) {
	setStatus( instrumentId, chanId, "tracking_mode", 3 );
	if( ! noEnable ) {
		setStatus( instrumentId, chanId, "enable", 1 );
	}
}

function stopChannel( instrumentId, chanId ) {
	setStatus( instrumentId, chanId, "tracking_mode", 0 );
	setStatus( instrumentId, chanId, "enable", 0 );
}

function enableChannel( instrumentId, chanId ) {
	setStatus( instrumentId, chanId, "enable", 1 );
}

function disableChannel( instrumentId, chanId ) {
	setStatus( instrumentId, chanId, "enable", 0 );
}

// Interval should be in milliseconds
function setTrackingInterval( instrumentId, chanId, interval ) {
	setStatus( instrumentId, chanId, "tracking_interval", parseFloat( interval ) );
}
	
// Interval should be in milliseconds
function scheduleTracking( instrumentId, chanId, interval ) {
	setStatus( instrumentId, chanId, "tracking_record_interval", parseInt( interval ) );
}

function setTrackingFWBWThreshold( instrumentId, chanId, threshold ) {
	setStatus( instrumentId, chanId, "tracking_fwbwthreshold", Math.min( 1, Math.max( 0, parseFloat( threshold ) ) ) );	
}

function setTrackingBWFWThreshold( instrumentId, chanId, threshold ) {
	setStatus( instrumentId, chanId, "tracking_bwfwthreshold", Math.min( 1, Math.max( 0, parseFloat( threshold ) ) ) );	
}

function setTrackingStepSize( instrumentId, chanId, stepsize ) {
	setStatus( instrumentId, chanId, "tracking_step", Math.max( 0, parseFloat( stepsize ) ) );	
}

function setTrackingSwitchDelay( instrumentId, chanId, delay ) {
	setStatus( instrumentId, chanId, "tracking_switchdelay", Math.max( 0, parseFloat( delay ) ) );	
}

function setIVStart( instrumentId, chanId, voltage ) {
	setStatus( instrumentId, chanId, "iv_start", Math.max( 0, parseFloat( voltage ) ) );	
}

function setIVStop( instrumentId, chanId, voltage ) {
	setStatus( instrumentId, chanId, "iv_stop", Math.max( 0, parseFloat( voltage ) ) );	
}

function setIVHysteresis( instrumentId, chanId, hysteresis ) {
	setStatus( instrumentId, chanId, "iv_hysteresis", !! hysteresis );	
}

function setIVRate( instrumentId, chanId, rate ) {
	setStatus( instrumentId, chanId, "iv_rate", Math.max( 0.001, parseFloat( rate ) ) );	
}
	
// Interval should be in seconds
function scheduleIVCurve( instrumentId, chanId, interval ) {
	setStatus( instrumentId, chanId, "iv_interval", parseInt( interval ) );
}

function executeIV( instrumentId, chanId ) {

	return MataHariIVScheduler.executeIV( instrumentId, chanId, getStatus( instrumentId, chanId ) );
}

MataHariIVScheduler.setCommand( requestIVCurve, requestIVCurveStatus, requestIVCurveData );
MataHariTrackScheduler.setCommands( requestTrackingData, updateInstrumentStatusChanId, requestVoc, requestJsc );

module.exports = {
	getChannels: getChannels,
	getStatus: getStatus,
	saveStatus: saveStatus,
	setStatus: setStatus,

	startChannelJsc: startChannelJsc,
	startChannelVoc: startChannelVoc,
	startChannelMPP: startChannelMPP,
	stopChannel: stopChannel,

	setTrackingBWFWThreshold: setTrackingBWFWThreshold,
	setTrackingFWBWThreshold: setTrackingFWBWThreshold,
	setTrackingSwitchDelay: setTrackingSwitchDelay,
	setTrackingStepSize: setTrackingStepSize,
	setTrackingInterval: setTrackingInterval,

	setIVStart: setIVStart,
	setIVStop: setIVStop,
	setIVHysteresis: setIVHysteresis,
	setIVRate: setIVRate,

	scheduleTracking: scheduleTracking,
	scheduleIVCurve: scheduleIVCurve,

	updateChannelStatus: updateInstrumentStatusChanId,
	updateAllStatus: updateAllStatus,

	executeIV: executeIV
};
