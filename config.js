'use strict';
const influx = require("./config/influx.json");

const instrument = require("./config/instrument.json");
const trackerControllers = require("./config/trackerControllers.json");
const relayControllers = require("./config/relayControllers.json");
const hosts = require("./config/hosts.json");

module.exports = {
	
	instrument: instrument,

	express: {
		port: 8080
	},

	influx: influx,

	hosts: hosts,
	trackerControllers: {

		hosts: trackerControllers,

		specialcommands: {
			getTrackData: ( chanId ) => { return { string: `DATA:TRACKER:CH${chanId}`, timeout: 1000 } },
			trackingResetData: ( chanId ) => { return { string: `TRACKING:RESET:CH${ chanId }`, timeout: 1000 } },
			autoZero: ( chanId ) => { return { string: `RESERVED:AUTOZERO${ chanId ? `:CH${ chanId }` : '' }` } },
			
			iv: {
				execute: ( chanId ) => { return { string: `IV:EXECUTE:CH${chanId}`, waitAfter: 1000 } },
				data: ( chanId ) => { return { string: `IV:DATA:CH${chanId}`, timeout: 10000 } },
				status: ( chanId ) => { return { string: `IV:STATUS:CH${chanId}` } }
			},
			
			i2c: {
				reader_4_20: ( slaveNumber, i2cAddress ) => { return { string: `I2C:4_20MA:CH${ slaveNumber }` } }
			},

			light: {
				enable:  ( chanId ) => { return { string: `LIGHT:ENABLE:CH${chanId}` } },
				disable:  ( chanId ) => { return { string: `LIGHT:DISABLE:CH${chanId}` } },
				isEnabled:  ( chanId ) => { return { string: `LIGHT:ENABLED?:CH${chanId}` } },
				isAutomatic:  ( chanId ) => { return { string: `LIGHT:AUTOMATIC?:CH${chanId}` } },
				setSetpoint:  ( chanId, value ) => { return { string: `LIGHT:SETPOINT:CH${chanId} ${value}` } },
				setScaling:  ( chanId , value) => { return { string: `LIGHT:SCALING:CH${chanId} ${value}` } },
				setOffset:  ( chanId , value) => { return { string: `LIGHT:OFFSET:CH${chanId} ${value}` } },
				check:  ( chanId ) => { return { string: `LIGHT:CHECK:CH${chanId}`, timeout: 30000 } },
				forcecheck:  ( chanId ) => { return { string: `LIGHT:FORCECHECK:CH${chanId}`, timeout: 30000 } },
				setPWM:  ( chanId, value ) => { return { string: `LIGHT:PWM:CH${chanId} ${value}` } }
			},

			lightExpander: {

				setIntensity: ( chanId, value ) => { return { string: `I2C:LIGHTEXPANDER:SETPWM:CH${ chanId } ${ value }`}}
			},

			dcdc: {
				getVoltage:  ( chanId ) => { return { string: `DCDC:VOLTAGE:CH${ chanId }` } },
				getCurrent:  ( chanId ) => { return { string: `DCDC:CURRENT:CH${ chanId }` } }
			},

			heat: {
				feedback: ( chanId, value ) => { return { string: `SSR:FEEDBACK:CH${ chanId } ${ value }` } },
				target: ( chanId, value ) => { return { string: `SSR:TARGET:CH${ chanId } ${ value }` } },
				heating:  ( chanId ) => { return { string: `SSR:HEATING:CH${ chanId }` } },
				cooling:  ( chanId ) => { return { string: `SSR:COOLING:CH${ chanId }` } },
				enable:  ( chanId ) => { return { string: `SSR:ENABLE:CH${ chanId }` } },
				disable:  ( chanId ) => { return { string: `SSR:DISABLE:CH${ chanId }` } },
				power:  ( chanId, power ) => { return { string: `SSR:VALUE:CH${ chanId } ${power}` } },
				pid_kp:  ( chanId, mode, value ) => { return { string: `SSR:KP_${ mode == 'heating' ? 'HEATING' : 'COOLING' }:CH${ chanId } ${ value }` } },
				pid_kd:  ( chanId, mode, value ) => { return { string: `SSR:KD_${ mode == 'heating' ? 'HEATING' : 'COOLING' }:CH${ chanId } ${ value }` } },
				pid_ki:  ( chanId, mode, value ) => { return { string: `SSR:KI_${ mode == 'heating' ? 'HEATING' : 'COOLING' }:CH${ chanId } ${ value }` } },
				pid_bias:  ( chanId, mode, value ) => { return { string: `SSR:BIAS_${ mode == 'heating' ? 'HEATING' : 'COOLING' }:CH${ chanId } ${ value }` } }
			},


			relay: {
				external: ( chanId, enabled ) => { return { string: `RELAY:EXTERNAL:CH${ chanId } ${ enabled ? 1 : 0 }` } },
				general: ( chanId, enabled ) => { return { string: `RELAY:GENERAL:CH${ chanId } ${ enabled ? 1 : 0 }` } }
			},
			
			acquisition: {
				speed: ( speed ) => "ACQUISITION:SPEED " + speed
			},

			readPD: {
				current: (pdId) => `ENVIRONMENT:PHOTODIODE:CH${pdId}`,
				sun: (pdId) => `ENVIRONMENT:SUNPHOTODIODE:CH${pdId}`
			},		

			voc: {
				trigger: ( chanId ) => { return { string: "MEASURE:VOC:CH" + chanId, timeout: 120000 } },
				status: ( chanId ) => { return "MEASURE:VOCSTATUS:CH" + chanId },
				data: ( chanId ) => { return { string: "MEASURE:VOCDATA:CH" + chanId, timeout: 3000 } }
			},

			jsc: {
				trigger: ( chanId ) => { return { string: "MEASURE:JSC:CH" + chanId, timeout: 120000 } },
				status: ( chanId ) => "MEASURE:JSCSTATUS:CH" + chanId,
				data: ( chanId ) => { return { string: "MEASURE:JSCDATA:CH" + chanId, timeout: 3000 } }
			},

			setVoltage: ( channel, value ) => "SOURCE:VOLTAGE:CH" + channel + " " + value,
			measureCurrent: ( channel ) => `MEASURE:CURRENT:CH${ channel }`,
			resetSlave: "RESERVED:RESETSLAVE",
			pauseHardware: "RESERVED:PAUSE",
			resumeHardware: "RESERVED:RESUME",
			readTemperatureChannelBase: ( slaveNumber, slaveId, chanId ) => { return { string: `ENVI:TBASE?:CH${chanId}:SLAVE${slaveNumber} ${slaveId}`, timeout: 20000 } },
			readTemperatureChannelIR: ( slaveNumber, slaveId, chanId ) => `ENVI:TIR?:CH${chanId}:SLAVE${slaveNumber} ${slaveId}`,
			readTemperature: ( slaveNumber, slaveId ) => `ENVI:TEMPBOX?:SLAVE${slaveNumber} ${slaveId}`,
			readHumidity: ( slaveNumber, slaveId ) => `ENVI:HUMIDITY?:SLAVE${slaveNumber} ${slaveId}`,
			readUVIntensity: ( slaveNumber ) => `ENVI:UVINTENSITY?:SLAVE${slaveNumber}`,
			reset: ( chanId ) => `TRACKING:RESET:CH${ chanId }`
			
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
			[ "RELAY:CHANNEL", function( status ) { return status.enable || 0; } ]
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
			"iv_measurement_interval_type": "fixed",
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
			"connection": "group",
			"lightRefValue": undefined,
			"measurementName": null,
			"cellName": null,
			"correctionFactor_type": "manual",
			"correctionFactor_value": 1
		},
	},

	relayControllers: {
		hosts: relayControllers
	}
};

