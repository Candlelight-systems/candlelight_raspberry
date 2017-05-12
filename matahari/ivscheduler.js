'use strict';

const influx = require("./influxhandler")
const queryManager = require("./queryhandler");

let intervals = {};
let queryManagers = {};

let requestIVCurve,
	requestIVCurveStatus,
	requestIVCurveData;

/*
	For the sake of simplicity, every IV scheduler has its own timer.
	This could become sluggish but I expect that since timers are called once a day or less,
	performance degradation should be quite minor. I hope the raspberry Pi can handle 32 concurrent intervals...
*/
function schedule( instrumentId, chanId, status ) {

	queryManagers[ instrumentId ] = queryManagers[ instrumentId ] || new queryManager();
	setTimer( instrumentId, chanId, status );
}

function hasTimeout( instrumentId, chanId ) {

	const intervalId = instrumentId + chanId + "";
	return !! intervals[ intervalId ];

}


function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}


function makeIV( instrumentId, chanId, status ) {

	
	if( ! requestIVCurve ) {
		throw "No launch command associated to the scheduler";
	}

	queryManagers[ instrumentId ].addQuery( async () => {

		await requestIVCurve( instrumentId, chanId );
		var i = 0;
		while( true ) {
			i++;
			
			var ivstatus = await requestIVCurveStatus( instrumentId, chanId );
			console.log("Status: " + ivstatus + " " + chanId );
			if( !ivstatus ) { // Once the curve is done, let's validate it
				break;
			}
			if( i > 100 ) { // Problem. 
				console.error("There has been a problem with getting the iv curve");
				break;
			}
			await delay( 1000 ); // Poling every second to see if IV curve is done
		}

		var ivCurveData = await requestIVCurveData( instrumentId, chanId );
		

		influx.storeIV( status.measurementName, ivCurveData );

		setTimer( instrumentId, chanId, status );
	
	} );
}


function setTimer( instrumentId, chanId, status ) {
	// Let's set another time
	const intervalId = instrumentId + chanId + "";

	if( intervals[ intervalId ] ) {
		clearTimeout( intervals[ intervalId ] );
	}

	intervals[ intervalId ] = setTimeout( () => {
		makeIV( instrumentId, chanId, status );
	}, status.iv_interval );
}


module.exports = {

	schedule: schedule,
	setCommand: function( _requestIVCurve, _requestIVCurveStatus, _requestIVCurveData ) {
		requestIVCurve = _requestIVCurve;
		requestIVCurveStatus = _requestIVCurveStatus;
		requestIVCurveData = _requestIVCurveData;
	},
	hasTimeout: hasTimeout
}