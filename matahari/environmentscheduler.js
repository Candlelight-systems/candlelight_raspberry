'use strict';

const influx = require("./influxhandler")
const queryManager = require("./queryhandler");

let intervals = {};
let queryManagers = {};
let requestTemperature,
	requestHumidity;

let temperature = {}, 
	humidity;
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

function unschedule( instrumentId, chanId ) {
	const intervalId = instrumentId + chanId + "";
	if( intervals[ intervalId ] ) {
		clearTimeout( intervals[ intervalId ] );
	}	
}


function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}


function getConditions( instrumentId, allChannels ) {

	
	if( ! requireTemperature || ! requestHumidity ) {
		throw "No launch command associated to the scheduler";
	}

	return queryManagers[ instrumentId ].addQuery( async () => {

		for( var i = 0; i < allChannels.length; i ++ ) {
			temperature[ allChannels[ i ].chanId ] = await requestTemperature( instrumentId, allChannels[ i ].chanId );
		}
		
		humidity = await requestHumidity( instrumentId );	
		setTimer( instrumentId, allChannels );
	});
}


function setTimer( instrumentId, allChannels ) {
	// Let's set another time
	const intervalId = instrumentId + chanId + "";

	if( intervals[ intervalId ] ) {
		clearTimeout( intervals[ intervalId ] );
	}

	intervals[ intervalId ] = setTimeout( () => {

		getConditions( instrumentId, chanId, status );

	}, 10 * 1000 * 60 );
}


module.exports = {

	schedule: schedule,
	setCommands: function( _requestTemperature, _requestHumidity ) {
		requestTemperature = _requestTemperature;
		requestHumidity = _requestHumidity;
	},
	hasTimeout: hasTimeout,
	unschedule: unschedule,

	getTemperature: function( channel ) {
		return temperature[ channel ];
	},

	getHumidity: function() {
		return humidity;
	}
}