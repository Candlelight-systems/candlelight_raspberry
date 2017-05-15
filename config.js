'use strict';
const influx = require("./influx.json");

module.exports = {
	
	express: {
		port: 8080
	},

	influx: influx,

	matahari: {

		specialcommands: {
			getTrackData: "DATA:TRACKER",
			executeIV: "IV:EXECUTE",
			getIVData: "DATA:IV",
			getIVStatus: "IV:STATUS?"
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

		instruments: [ 
			{
				instrumentId: "matahari1000",

				config: {
					host: "/dev/serial/by-id/usb-Arduino_LLC_Arduino_Zero-if00",
					params: {
						baudrate: 115200
					},
					reconnectTimeout: 1000
				},

				channels: [
					{ chanId: 1, chanName: "Channel 1" },
					{ chanId: 2, chanName: "Channel 2" },
					{ chanId: 3, chanName: "Channel 3" },
					{ chanId: 4, chanName: "Channel 4" },
					{ chanId: 5, chanName: "Channel 5" },
					{ chanId: 6, chanName: "Channel 6" },
					{ chanId: 7, chanName: "Channel 7" },
					{ chanId: 8, chanName: "Channel 8" },
					{ chanId: 9, chanName: "Channel 9" },
					{ chanId: 10, chanName: "Channel 10" },
					{ chanId: 11, chanName: "Channel 11" },
					{ chanId: 12, chanName: "Channel 12" },
					{ chanId: 13, chanName: "Channel 13" },
					{ chanId: 14, chanName: "Channel 14" },
					{ chanId: 15, chanName: "Channel 15" },
					{ chanId: 16, chanName: "Channel 16" }
				]
			}
		]
	}
};
