'use strict';

let status = require("./status.json").channels;
let serialport = require("serialport");
let influx = require("influx");

const config = require("../config");
const MataHariIVScheduler = require("./ivscheduler");
const MataHariTrackScheduler = require("./trackscheduler");
const matahariconfig = config.matahari;
const fs = require("fs");

let connections = {};
openConnections();


async function normalizeStatus() {	

	let instrumentId, chanId;

	for( var i = 0; i < matahariconfig.instruments.length; i ++ ) {

		for( var j = 0, l = matahariconfig.instruments[ i ].channels.length; j < l; j ++ ) {

			instrumentId = matahariconfig.instruments[ i ].instrumentId;
			chanId = matahariconfig.instruments[ i ].channels[ j ].chanId;

			if( ! getStatus( instrumentId, chanId ) ) {

				status.push( { instrumentId: instrumentId, chanId: chanId } );
			}
		}

		filesaveStatus();
	}


	for( let i = 0; i < status.length; i++ ) {
		await updateInstrumentStatusChanId( status[ i ].instrumentId, status[ i ].chanId );
	}
}


function filesaveStatus() {
	
	return fs.writeFileSync("matahari/status.json", JSON.stringify( { channels: status }, undefined, "\t" ) );
}

normalizeStatus();



function openConnections() {

	matahariconfig.instruments.map( ( instrumentConfig ) => {

		const cfg = instrumentConfig.config;
		const connection = new serialport( cfg.host, cfg.params );
		connection.on("error", ( err ) => {
			throw "Error thrown by the serial communication: ", err;
		} );

		connection.on("open", () => {
			connection.write("RESERVED:REFENABLE\n");
		} );

		connection.on("close", ( ) => {

			setTimeout( () => {

				connection.open();

				updateAllInstrumentStatus( instrumentConfig.instrumentId );

			}, cfg.reconnectTimeout );
		} );

		connections[ instrumentConfig.instrumentId ] = connection;
		connections[ instrumentConfig.instrumentId ].lease = Promise.resolve();
	} );
}


function getChannels() {

	let chans = [];

	for( var i = 0; i < matahariconfig.instruments.length; i ++ ) {

		chans = chans.concat( 
			matahariconfig.instruments[ i ].channels.map( 
				( el ) => { el.instrumentId = matahariconfig.instruments[ i ].instrumentId; return el; }
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

async function saveStatus( instrumentId, chanId, chanStatus ) {

	if( instrumentId === undefined || chanId === undefined ) {
		throw "Cannot set channels status";
	}

	scheduleIVCurve( instrumentId, chanId, chanStatus.tracking_record_interval );
	scheduleTracking( instrumentId, chanId, chanStatus.tracking_record_interval );

	setTrackingInterval(  instrumentId, chanId, chanStatus.tracking_interval );
	setTrackingBWFWThreshold( instrumentId, chanId, chanStatus.tracking_bwfwthreshold );
	setTrackingFWBWThreshold( instrumentId, chanId, chanStatus.tracking_fwbwthresholds );
	setTrackingStepSize( instrumentId, chanId, chanStatus.tracking_stepsize );
	setTrackingSwitchDelay( instrumentId, chanId, chanStatus.tracking_switchdelay );

	setIVStart( instrumentId, chanId, chanStatus.tracking_ivstart );
	setIVStop( instrumentId, chanId, chanStatus.tracking_ivstop );
	setIVHysteresis( instrumentId, chanId, chanStatus.tracking_ivhysteresis );
	setIVRate( instrumentId, chanId, chanStatus.tracking_ivrate );

	if( chanStatus.enable ) {
		enableChannel( instrumentId, chanId );
	} else {
		disableChannel( instrumentId, chanId );
	}

	switch( chanStatus.tracking_mode ) {

		case "voc":
			startChannelVoc( instrumentId, chanId );
		break;

		case "jsc":
			startChannelVoltage( instrumentId, chanId );
		break;

		case "mppt":
			startChannelMPPT( instrumentId, chanId );
		break;

		case "none":
			stopChannel( instrumentId, chanId );
		break;
	}

	await updateInstrumentStatusChanId( instrumentId, chanId );

	for( var i = 0; i < status.length; i ++ ) {

		if( status[ i ].chanId == chanId && status[ i ].instrumentId == instrumentId ) {

			status[ i ] = chanStatus;
		}
	}

	return filesaveStatus();
}


async function requestTrackingData( instrumentId, channelId ) {

	let comm = connections[ instrumentId ],
		data = "",
		data2;

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	await comm.lease;

	return comm.lease = new Promise( ( resolver, rejecter ) => {


    const startSave = Date.now();

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
					await delay( 100 );
					comm.removeAllListeners( "data" );
					resolver( data2 );
					data = "";
					break;
				}
			}
		} );	
		comm.write( matahariconfig.specialcommands.getTrackData + ":CH" + channelId + "\n" );
	} );
}


async function requestIVData( instrumentId, channelId ) {

	let comm = connections[ instrumentId ],
		data = "";
	
	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	await comm.lease;

	return comm.lease = new Promise( async ( resolver, rejecter ) => {

		comm.removeAllListeners( "data" );
		comm.on( "data", async ( data ) => {

			data = data.toString('ascii'); // SAMD sends ASCII data
			if( data.indexOf("\n") > -1 ) {

				comm.removeAllListeners( "data" );
				await delay( 100 );
				resolver( data );
			}
		} );

		
		comm.write( matahariconfig.specialcommands.executeIV + ":CH" + channelId + "\n" );
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

async function updateInstrumentStatusChanId( instrumentId, chanId ) {

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

	await ( comm.lease );

	return comm.lease = new Promise( async ( resolver ) => {
		
		await delay( 100 ); // Allow some buffering time	

		for( let cmd of matahariconfig.statuscommands ) {
			
			await new Promise( async ( resolver ) => {

				let command = cmd[ 0 ] + ":CH" + chanId + " " + cmd[ 1 ]( chanStatus ) + "\n";
				let data = "";				
				comm.on( "data", async ( d ) => {

					data += d.toString('ascii'); // SAMD sends ASCII data
					if( data.indexOf("\n") > -1 ) {
						console.log('dataok');
						comm.removeAllListeners( "data" );
						
						data = "";	
						resolver();
					}
				} );

				if( comm.isOpen() ) {
					comm.write( command );
					comm.drain();
				}

				comm.once("open", async () => {
					comm.write( command );
					comm.drain();
				} );
			} );

			await delay( 100 ); // Allow some buffering time	
		}

		// Handle IV scheduling
		if( chanStatus.iv_interval > 0 && chanStatus.iv_interval !== null && chanStatus.iv_interval !== undefined ) {
			//MataHariIVScheduler.schedule( instrumentId, chanId, chanStatus );
		}

		if( chanStatus.tracking_mode > 0 && chanStatus.tracking_record_interval > 0 &&  chanStatus.tracking_record_interval !== null && chanStatus.tracking_record_interval !== undefined ) {
			
			MataHariTrackScheduler.schedule( instrumentId, chanId, chanStatus );
		}

		resolver();
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

function stopChannel( instrumentId, chanId, noEnable = false ) {
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

function setIVHysteresis( instrumentId, chanId, voltage ) {
	setStatus( instrumentId, chanId, "iv_hysteresis", Math.max( 0, !! parseInt( voltage ) ) );	
}

function setIVRate( instrumentId, chanId, rate ) {
	setStatus( instrumentId, chanId, "iv_rate", Math.max( 0.001, parseFloat( rate ) ) );	
}
	
// Interval should be in seconds
function scheduleIVCurve( instrumentId, chanId, interval ) {
	//setStatus( instrumentId, chanId, "iv_interval", parseInt( interval ) );
}

MataHariIVScheduler.setCommand( requestIVData );
MataHariTrackScheduler.setCommands( requestTrackingData, updateInstrumentStatusChanId );

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
	updateAllStatus: updateAllStatus
};