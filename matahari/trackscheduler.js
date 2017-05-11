'use strict';

const influx = require("./influxhandler")

let intervals = {};
let command, requestVoc, requestJsc, commandUpdateChannelStatus;

let ready = {};
let forbidLog = {};
/*
	For the sake of simplicity, every track scheduler has its own timer.
	This may be really problematic from the perspective of CPU. Maybe bundle in one single timer
*/

function hasTimeout( mode, instrumentId, chanId ) {

	switch( mode ) {
		case 'mpp':
			return !! intervals[ instrumentId + "_" + chanId ]
		break;

		case 'voc':
			return !! intervals[ instrumentId  + chanId + "_voc" ]
		break;

		case 'jsc':
			return !! intervals[ instrumentId  + chanId  + "_jsc" ]
		break;
	}

}

function schedule( instrumentId, chanId, status ) {
	scheduleTrack( ...arguments );
}

function scheduleVoc( instrumentId, chanId, status ) {
	setupTimeout("voc", instrumentId, chanId, measureVoc, status );	
}

function scheduleJsc( instrumentId, chanId, status ) {
	setupTimeout("jsc", instrumentId, chanId, measureJsc, status );	
}


function scheduleTrack( instrumentId, chanId, status ) {

	const timeout = status.track_record_interval;
	const intervalId = instrumentId + "_" + chanId;

	
	if( intervals[ intervalId ] ) {
		clearTimeout( intervals[ intervalId ] );
	}

	if( timeout < 0 ) {
		delete intervals[ intervalId ];
		return;
	}

	intervals[ intervalId ] = setTimeout( () => {		

		if( parseInt( status.tracking_mode ) !== 1 || forbidLog[ intervalId ]) {
			scheduleTrack( instrumentId, chanId, status );
			return;
		}

		getData( instrumentId, chanId, status ).then( () => {

			scheduleTrack( instrumentId, chanId, status );
		}).catch( ( error ) => {
			console.error(`Could not track data: ${error.stack}`);
		});

	}, status.tracking_record_interval );
}

function measureVoc( instrumentId, chanId, status, equilibration ) {

	return requestVoc( instrumentId, chanId, status, () => {
		forbidLog[ instrumentId + "_" + chanId ] = true;
	}, equilibration ).then( ( voc ) => {
		influx.storeVoc( status.measurementName, voc);
		forbidLog[ instrumentId + "_" + chanId ] = false;	
	}).catch( () => {
		forbidLog[ instrumentId + "_" + chanId ] = false;	
	});
}


function measureJsc( instrumentId, chanId, status, equilibration ) {

	return requestJsc( instrumentId, chanId, status, () => {
		forbidLog[ instrumentId + "_" + chanId ] = true;
	}, equilibration ).then( ( jsc ) => {
		influx.storeJsc( status.measurementName, jsc);
		forbidLog[ instrumentId + "_" + chanId ] = false;	
	}).catch( () => {
		forbidLog[ instrumentId + "_" + chanId ] = false;	
	});
}


function setupTimeout( mode, instrumentId, chanId, callback, status ) {

	let track, trackInterval, trackTime;

	switch( mode ) {

		case "voc":

			// Voc tracking
			track = status.tracking_measure_voc;
			trackInterval = status.tracking_measure_voc_interval;
			trackTime = status.tracking_measure_voc_time;

		break;

		case "jsc":

			// Jsc tracking
			track = status.tracking_measure_jsc;
			trackInterval = status.tracking_measure_jsc_interval;
			trackTime = status.tracking_measure_jsc_time;
		break;
	}
	
	const intervalId = instrumentId + chanId + "_" + mode;

	if( ! track ) {
		if( intervals[ intervalId ] ) {
			clearTimeout( intervals[ intervalId ] );
			intervals[ intervalId ] = false;
		}

		return;
	}

	if( intervals[ intervalId ] ) {
		return;
	}

	intervals[ intervalId ] = setTimeout( async () => {		
		
		intervals[ intervalId ] = false;
		
		await callback( instrumentId, chanId, status, trackTime );
	}, trackInterval );
}



function getData( instrumentId, chanId, status ) {

	if( ! command ) {
		throw "No launch command associated to the scheduler";
	}

	// results should be a waveform (voltage,current)
	return command( instrumentId, chanId ).then( ( results ) => {

		let voltageMean = results[ 0 ],
			currentMean = results[ 1 ],
			powerMean = results[ 2 ],
			voltageMin = results[ 3 ],
			currentMin = results[ 4 ],
			powerMin = results[ 5 ],
			voltageMax = results[ 6 ],
			currentMax = results[ 7 ],
			powerMax = results[ 8 ],
			nb = results[ 10 ];

		if( parseInt( nb ) == 0 ) {
			return;
		}

		//results[9] in sun
		// W cm-2
		let efficiency = ( powerMean / (status.cellArea) ) / ( results[ 9 ] * 0.1 ) * 100;

		return influx.storeTrack( status.measurementName, {

			voltageMean: voltageMean,
			currentMean: currentMean,
			powerMean: powerMean,
			voltageMin: voltageMin,
			currentMin: currentMin,
			powerMin: powerMin,
			voltageMax: voltageMax,
			currentMax: currentMax,
			powerMax: powerMax,
			efficiency: efficiency
		} );

	} ).catch( ( error ) => {
		console.log( error );
		throw error;
	} );
}

module.exports = {

	schedule: schedule,
	scheduleVoc: scheduleVoc,
	scheduleJsc: scheduleJsc,
	hasTimeout: hasTimeout,

	setCommands: function( cmdRequestData, cmdUpdateChannelStatus, reqVoc, reqJsc ) {
		command = cmdRequestData;
		commandUpdateChannelStatus = cmdUpdateChannelStatus;
		requestVoc = reqVoc;
		requestJsc = reqJsc;
	}
}