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


module.exports = {

	schedule: schedule,
	setCommand: function( _requestIVCurve, _requestIVCurveStatus, _requestIVCurveData ) {
		requestIVCurve = _requestIVCurve;
		requestIVCurveStatus = _requestIVCurveStatus;
		requestIVCurveData = _requestIVCurveData;
	},

	hasTimeout: hasTimeout,
	unschedule: unschedule,
	executeIV: makeIV
};