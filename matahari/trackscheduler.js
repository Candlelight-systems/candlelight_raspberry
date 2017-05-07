'use strict';

const influx = require("./influxhandler")

let intervals = {};
let command, commandJsc, commandVoc, commandMPPT, commandUpdateChannelStatus, commandTrackingInterval;

let ready = {};
let forbidLog = {};
/*
	For the sake of simplicity, every track scheduler has its own timer.
	This may be really problematic from the perspective of CPU. Maybe bundle in one single timer
*/

async function schedule( instrumentId, chanId, status ) {

	scheduleTrack( ...arguments );
	setupTimeout("voc", instrumentId, chanId, measureVoc, status );	
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
			return;
		}

		getData( instrumentId, chanId, status ).then( () => {
			scheduleTrack( instrumentId, chanId, status );
		});

	}, 1000 );
}

function measureVoc( instrumentId, chanId, delay, status ) {

	ready[ instrumentId + "_" + chanId ] = ready[ instrumentId + "_" + chanId ] || new Promise( ( resolver ) => { resolver(); } );
	return ready[ instrumentId + "_" + chanId ] = ready[ instrumentId + "_" + chanId ].then( () => {

		forbidLog[ instrumentId + "_" + chanId ] = true;

		return new Promise( async ( resolver, rejecter ) => {

			let statusSaved = status.tracking_mode,	
				intervalSaved = status.tracking_interval;

			status.tracking_mode = 2;
			status.tracking_interval = 10;
			await commandUpdateChannelStatus( instrumentId, chanId );
				
			setTimeout( () => {

				command( instrumentId, chanId ).then( async ( results ) => {
					
					let voc = results[ 0 ];		

					status.tracking_mode = statusSaved;
					status.tracking_interval = intervalSaved;

					//await commandUpdateChannelStatus( instrumentId, chanId );
					await influx.storeVoc( status.measurementName, voc);
					setupTimeout("voc", instrumentId, chanId, measureVoc, status );
					status._action = undefined;
					
					setTimeout( () => {
						forbidLog[ instrumentId + "_" + chanId ] = false;
						resolver();
					}, 5000 );

					return;
				});

			}, delay );
		} );

	} )

}


function measureJsc( instrumentId, chanId, delay, status ) {


	ready[ instrumentId + "_" + chanId ] = ready[ instrumentId + "_" + chanId ] || new Promise( ( resolver ) => { resolver(); } );
	return ready[ instrumentId + "_" + chanId ] = ready[ instrumentId + "_" + chanId ].then( () => {

		forbidLog[ instrumentId + "_" + chanId ] = true;

		return new Promise( async ( resolver, rejecter ) => {

			let statusSaved = status.tracking_mode,	
				intervalSaved = status.tracking_interval;

			status.tracking_mode = 3;
			status.tracking_interval = 10;

			await commandUpdateChannelStatus( instrumentId, chanId );
				
			setTimeout( () => {

				command( instrumentId, chanId ).then( async ( results ) => {
					
					let jsc = results[ 1 ];		

					status.tracking_mode = parseInt( statusSaved );
					status.tracking_interval = intervalSaved;
					commandUpdateChannelStatus( instrumentId, chanId );

					status._action = undefined;
					await influx.storeJsc( status.measurementName, jsc);
					
					setupTimeout("jsc", instrumentId, chanId, measureJsc, status );
					
					setTimeout( () => {
						forbidLog[ instrumentId + "_" + chanId ] = false;
						resolver();
					}, 5000 );

					return;
				});

			}, delay );
		} );
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
		
		await callback( instrumentId, chanId, trackTime, status );
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

		let efficiency = powerMean / results[ 9 ] * 100;

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

		throw error;
	} );
}

module.exports = {

	schedule: schedule,
	setCommands: function( cmdRequestData, cmdUpdateChannelStatus ) {
		command = cmdRequestData;
		commandUpdateChannelStatus = cmdUpdateChannelStatus;
	}
}