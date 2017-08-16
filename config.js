'use strict';
const influx = require("./config/influx.json");
const mux = require("./config/mux.json");
const instrument = require("./config/instrument.json");
const trackers = require("./config/trackers.json");

module.exports = {
	
	instrument: instrument,

	express: {
		port: 8080
	},

	influx: influx,

	matahari: {

		specialcommands: {
			getTrackData: "DATA:TRACKER",
			executeIV: "IV:EXECUTE",
			readPD1: "MEASURE:PHOTODIODE1",
			readPD2: "MEASURE:PHOTODIODE2",
			getIVData: "DATA:IV",
			getIVStatus: ( channel ) => "IV:STATUS? CH" + channel,
			pauseHardware: "RESERVED:PAUSE",
			resumeHardware: "RESERVED:RESUME"
		},

		statuscommands: [

			[ "IV:START", function( status ) { return status.iv_start || 1; } ],
			[ "IV:STOP", function( status ) { return status.iv_stop || 0; } ],
			[ "IV:HYSTERESIS", function( status ) { return +( !! status.iv_hysteresis ); } ],
			[ "IV:RATE", function( status ) { return status.iv_rate || 0.02; } ],

			[ "TRACKING:MODE", function( status ) { return status.tracking_mode || "0"; } ],
			[ "TRACKING:INTERVAL", function( status ) { return status.tracking_interval || 1; } ],
			[ "TRACKING:FWBWTHRESHOLD", function( status ) { return status.tracking_fwbwthreshold || 0.99; } ],
			[ "TRACKING:BWFWTHRESHOLD", function( status ) { return status.tracking_bwfwthreshold || 0.99; } ],
			[ "TRACKING:STEP", function( status ) { return status.tracking_step || 0.001; } ],
			[ "TRACKING:SWITCHDELAY", function( status ) { return status.tracking_switch_delay || 1; } ],

			[ "OUTPUT:ENABLE", function( status ) { return status.enable || 0; } ]
		],

		defaults: {
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
			"cellArea": 0,
			"lightRef": "pd1",
			"lightRefValue": null,
			"measurementName": null,
			"cellName": null
		},
		
		trackers: trackers
	}
};
