'use strict';
const influx = require("./config/influx.json");

const instrument = require("./config/instrument.json");
const trackerControllers = require("./config/trackerControllers.json");
const relayControllers = require("./config/relayControllers.json");


module.exports = {
	
	instrument: instrument,

	express: {
		port: 8080
	},

	influx: influx,

	hosts: [

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.2:1.0",
			"alias": "Small cells",
			"constructorName": "TrackerController",
			"resetPin": 40,
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		},
		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.4:1.0",
			"alias": "Small modules",
			"constructorName": "TrackerController",
			"resetPin": 40,
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		},
		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.5:1.0",
			"alias": "relay1",
			"constructorName": "RelayController",
			"resetPin": 40,
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		}/*,

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.5:1.0",
			"alias": "Light",
			"constructorName": "LightController",
			
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		},


		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.4:1.0",
			"alias": "heat1",
			"constructorName": "HeatController",
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		}*/
/*

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.3:1.0",
			"alias": "relay1",
			"resetPin": 21,
			"constructorName": "RelayController",
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds

		},

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.5:1.0",
			"alias": "heat1",
			"resetPin": 22,
			"constructorName": "HeatController",
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		},

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.2:1.0",
			"alias": "Tracker 1",
			"constructorName": "TrackerController",
			"resetPin": 12,
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		}
>>>>>>> 14183a1113a97636bff9fb7897004fc0e52d9712

		{	
			"host": "/dev/serial/by-path/platform-3f980000.usb-usb-0:1.2:1.0",
			"alias": "Tracker 1",
			"constructorName": "TrackerController",
			"resetPin": 12,
			"params": {
				"baudrate": 57600
			},
			"reconnectTimeout": 1 // in seconds
		}
*/
	],


	trackerControllers: {

		hosts: trackerControllers,

		specialcommands: {
			getTrackData: "DATA:TRACKER",

			iv: {
				execute: "IV:EXECUTE",
				data: "IV:DATA",
				status: "IV:STATUS",
			},

			light: {
				enable: 'LIGHT:ENABLE',
				disable: 'LIGHT:DISABLE',
				isEnabled: 'LIGHT:ENABLED?',
				isAutomatic: 'LIGHT:AUTOMATIC?',
				setSetpoint: 'LIGHT:SETPOINT',
				setScaling: 'LIGHT:SCALING',
				check: 'LIGHT:CHECK'
			},

			acquisition: {
				speed: ( speed ) => "ACQUISITION:SPEED " + speed
			},

			readPD: {
				current: "ENVIRONMENT:PHOTODIODE",
				sun: "ENVIRONMENT:SUNPHOTODIODE"
			},		

			voc: {
				trigger: "MEASURE:VOC",
				status: "MEASURE:VOCSTATUS",
				data: "MEASURE:VOCDATA"
			},

			jsc: {
				trigger: "MEASURE:JSC",
				status: "MEASURE:JSCSTATUS",
				data: "MEASURE:JSCDATA"
			},

			setVoltage: ( channel, value ) => "SOURCE:VOLTAGE:CH" + channel + " " + value,
			measureCurrent: ( channel ) => "MEASURE:CURRENT:CH" + channel,
			resetSlave: "RESERVED:RESETSLAVE",
			pauseHardware: "RESERVED:PAUSE",
			resumeHardware: "RESERVED:RESUME",
			readTemperatureChannelBase: ( slaveId, chanId ) => "ENVIRONMENT:TEMPBASE? " + slaveId,
			readTemperatureChannelIR: ( slaveId, chanId ) => "ENVIRONMENT:TEMPIR? " + slaveId,
			readTemperature: ( slaveId ) => "ENVIRONMENT:TEMPBOX? " + slaveId,
			readHumidity: ( slaveId ) => "ENVIRONMENT:HUMIDITY? " + slaveId
			
		},

		statuscommands: [

			[ "IV:START", function( status ) { return status.iv_start || 1; } ],
			[ "IV:AUTOSTART", function( status ) { return +status.iv_autostart || 0; } ],
			[ "IV:STOP", function( status ) { return status.iv_stop || 0; } ],
			[ "IV:HYSTERESIS", function( status ) { return +( !! status.iv_hysteresis ); } ],
			[ "IV:RATE", function( status ) { return status.iv_rate || 0.02; } ],
			[ "TRACKING:GAIN", function( status ) { return status.tracking_gain || -1; } ],
			[ "TRACKING:FWBWTHRESHOLD", function( status ) { return status.tracking_fwbwthreshold; } ],
			[ "TRACKING:BWFWTHRESHOLD", function( status ) { return status.tracking_bwfwthreshold; } ],
			[ "TRACKING:SWITCHDELAY", function( status ) { return status.tracking_switch_delay || 1; } ],
			[ "TRACKING:INTERVAL", function( status ) { return status.tracking_interval || 1; } ],
			[ "TRACKING:STEP", function( status ) { return status.tracking_step || 0.001; } ],
			[ "TRACKING:MODE", function( status ) { return status.tracking_mode || "0"; } ],
			[ "TRACKING:PHOTODIODE", function( status, groupConfig ) { return groupConfig ? ( groupConfig.light ? -1 || -1 : -1 ) : -1; } ], // groupConfig.light.channelId
			[ "OUTPUT:ENABLE", function( status ) { return status.enable || 0; } ]
		],

		defaults: {
			"tracking_record_interval": 10000,
			"tracking_interval": 100,
			"tracking_bwfwthreshold": 0,
			"tracking_fwbwthreshold": 0,
			"tracking_step": 1,
			"tracking_switchdelay": 1,
			"iv_start": 1,
			"iv_autostart": 0,
			"iv_stop": 0,
			"iv_hysteresis": 0,
			"iv_rate": 0.1,
			"iv_interval": 24 * 3600 * 1000,
			"enable": 0,
			"tracking_gain": -1,
			"tracking_measure_jsc": 0,
			"tracking_measure_voc": 0,
			"tracking_measure_jsc_time": 10000,
			"tracking_measure_voc_time": 10000,
			"tracking_measure_jsc_interval": 24 * 3600 * 1000,
			"tracking_measure_voc_interval": 24 * 3600 * 1000,
			"tracking_mode": 0,
			"cellArea": 0,

			"connection": "external",
			"lightRefValue": 1000,

			"measurementName": null,
			"cellName": null
		},
	},

	relayControllers: {
		hosts: relayControllers
	}
};

