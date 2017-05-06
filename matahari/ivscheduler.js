'use strict';

const influx = require("./influxhandler")

let intervals = {};
let command;



/*
	For the sake of simplicity, every IV scheduler has its own timer.
	This could become sluggish but I expect that since timers are called once a day or less,
	performance degradation should be quite minor. I hope the raspberry Pi can handle 32 concurrent intervals...
*/

function schedule( instrumentId, chanId, status ) {

	const intervalId = instrumentId + chanId + "";
	const timeout = status.iv_interval;


	if( intervals[ intervalId ] ) {
		clearInterval( intervals[ intervalId ] );
	}

	if( timeout < 0 ) {
		delete intervals[ intervalId ];
		return;
	}

	intervals[ intervalId ] = setInterval( () => {
		makeIV( instrumentId, chanId, status );
	}, timeout );
}

function makeIV( instrumentId, chanId, status ) {

	if( ! command ) {
		throw "No launch command associated to the scheduler";
	}

	// results should be a waveform (voltage,current)
	command( instrumentId, chanId ).then( ( results ) => {

		return influx.storeIV( status.measurementName, results );

	} ).catch( ( error ) => {

		throw error;
	} );
}

module.exports = {

	schedule: schedule,
	setCommand: function( cmd ) {
		command = cmd;
	}
}