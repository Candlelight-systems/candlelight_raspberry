
const fs 						= require('fs');
const HostManager 				= require("../hostmanager");
const config					= require("../config");
const { trackerControllers } 	= require("../config");
const TrackerController 		= require("./trackercontroller");
let allMeasurements 			= require("./measurements.json");

let allMeasurements 			= require("./measurements.json");
const wsconnection				= require('../wsconnection' );

let instrumentInstances = {};

for( var i = 0; i < config.hosts.length; i ++ ) {

	if( config.hosts[ i ].constructorName == "TrackerController" ) {
		let host = HostManager.addHost( config.hosts[ i ], undefined, TrackerController );	
		instrumentInstances[ config.hosts[ i ].alias ] = host;

		host.setInstrumentConfig( trackerControllers.hosts[ config.hosts[ i ].alias ] );
		host.init();
	}
}

function getInstrument( alias ) {

	if( instrumentInstances[ alias ] ) {
		return instrumentInstances[ alias ];
	}

	return instrumentInstances[ alias ];
}

function lookupChanId( instrumentId, chanNumber ) {

	return getInstrument( instrumentId ).lookupChanId( chanNumber );
}

module.exports = {

	getInstruments() {
		return trackerControllers.hosts;
	},

	getChannels: ( instrumentId, groupName ) => {

		return getInstrument( instrumentId ).getChannels( groupName );
	},


	getGroups: ( instrumentId ) => {

		return getInstrument( instrumentId ).getGroups();
	},

	getStatus: ( instrumentId, chanNumber ) => {

		chanNumber = parseInt( chanNumber );
		const chanId = lookupChanId( instrumentId, chanNumber );

		
		let instrument = getInstrument( instrumentId ),
			groups = instrument.getGroups(),
			returnObject = {};

		groups.forEach( ( group ) => {

			returnObject[ group.groupName ] = {
				channels: {}
			};

			if( group.heatController ) {
				returnObject[ group.groupName ].heatingPower = instrument.getHeatingPower( group.groupName );
			}

			if( instrument.hasLightController( group.groupName ) ) {
				returnObject[ group.groupName ].lightController = true;

				returnObject[ group.groupName ].lightSetpoint = instrument.getLightController( group.groupName ).getSetPoint( group.groupName );
				returnObject[ group.groupName ].lightModeAutomatic = instrument.getLightController( group.groupName ).isModeAutomatic( group.groupName );

			}

			group.channels.forEach( ( channel ) => {

				if( chanId && chanId !== channel.chanId ) {
					return;
				}

				returnObject[ group.groupName ].channels[ channel.chanId ] = instrument.getStatus( channel.chanId );
			});
		});

		return returnObject;
	},

	getPDOptions: ( instrumentId, groupName ) => {
		return getInstrument( instrumentId ).getPDOptions( groupName );
	},

	setPDScaling: async ( instrumentId, pdRef, pdScale ) => {
		await getInstrument( instrumentId ).setPDScaling( pdRef, pdScale );
		fs.writeFileSync('./config/trackerControllers.json', JSON.stringify( trackerControllers.hosts, undefined, "\t" ) );
	},

	getInstrumentConfig: ( instrumentId ) => {
		return getInstrument( instrumentId ).getInstrumentConfig();
	},

	getGroupConfig: ( instrumentId, groupName ) => {
		return getInstrument( instrumentId ).getConfig( groupName, undefined );
	},

	getChannelConfig: ( instrumentId, chanNumber ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).getConfig( undefined, chanId );
	},

	executeIV: ( instrumentId, chanNumber ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).makeIV( chanId );
	},

	measureVoc: ( instrumentId, chanNumber, extend ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).measureVoc( chanId, extend );
	},

	measureJsc: ( instrumentId, chanNumber ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).measureJsc( chanId );
	},


	pauseChannels: async ( instrumentId ) => {
		const instrument = getInstrument( instrumentId );
		await instrument.pauseChannels();
		let groups = instrument.getInstrumentConfig().groups;
		for( var i = 0, l = groups.length; i < l; i ++ ) {
			await wsconnection.send( { 
				instrumentId: instrumentId, 
				groupName: groups[ i ].groupName,
				state: {
					paused: true
				} 
			} );	
		}
	},

	resumeChannels: async ( instrumentId ) => {
		const instrument = getInstrument( instrumentId );
		await instrument.resumeChannels();
		let groups = instrument.getInstrumentConfig().groups;
		for( var i = 0, l = groups.length; i < l; i ++ ) {
			await wsconnection.send( { 
				instrumentId: instrumentId, 
				groupName: groups[ i ].groupName,
				state: {
					paused: false
				} 
			} );	
		}
	},

	saveStatus: ( instrumentId, chanNumber, status ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).saveStatus( chanId, status );
	},

	resetStatus: ( instrumentId, chanNumber, status ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).resetStatus( chanId, status );
	},

	setVoltage: async ( instrumentId, chanNumber, voltage ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		await getInstrument( instrumentId ).saveStatus( chanId, { tracking_mode: 0 } );
		await getInstrument( instrumentId ).setVoltage( chanId, voltage );
	},

	measureCurrent: ( instrumentId, chanNumber, voltage ) => {

		const chanId = lookupChanId( instrumentId, chanNumber );
		let instrument = getInstrument( instrumentId );
		if( chanId.indexOf( 'pd' ) > -1 ) {

			return instrument._measurePD( chanId );

		} else {

			return instrument.measureCurrent( chanId );
		}
	},

	enableChannel: ( instrumentId, chanNumber ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).enableChannel( chanId );
	},

	disableChannel: ( instrumentId, chanNumber ) => {
		const chanId = lookupChanId( instrumentId, chanNumber );
		return getInstrument( instrumentId ).disableChannel( chanId );
	},

	getLightController: async ( instrumentId, groupName ) => {
		
		let instrument = getInstrument( instrumentId );

		if( instrument.hasLightController( groupName ) ) {
			return getInstrument( instrumentId ).getLightControllerConfig( groupName );
		}
		
		throw "This instrument has no light controller";
	},


	saveLightController: async ( instrumentId, groupName, cfg ) => {
		let savingPromise = getInstrument( instrumentId ).saveLightController( groupName, cfg );
		fs.writeFileSync('./config/trackerControllers.json', JSON.stringify( config.hosts, undefined, "\t" ) );

		return savingPromise;
	},

	setHeatingPower: async( instrumentId, groupName, power ) => {
		let instrument = getInstrument( instrumentId );
		await instrument.setHeatingPower( groupName, power );
	},

	increaseHeatingPower: async( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return await instrument.increaseHeatingPower( groupName );
	},

	decreaseHeatingPower: async( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return await instrument.decreaseHeatingPower( groupName );
	},

	getHeatingPower: async( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return instrument.getHeatingPower( groupName );

	},

	getAllMeasurements: () => {
		return allMeasurements;
	},

	dropMeasurement: ( measurementName ) => {
		if( ! allMeasurements[ measurementName ] ) {
			throw `No measurement with the nme ${measurementName} exist`;
		}

		delete allMeasurements[ measurementName ];
		fs.writeFileSync("./trackercontroller/measurement.json");
	},

	resetSlave( instrumentId ) {
		let instrument = getInstrument( instrumentId );
		return instrument.resetSlave( );
	},

	lightDisable( instrumentId, groupName ) {
		getInstrument( instrumentId ).lightDisable( groupName );
	},

	lightEnable( instrumentId, groupName ) {
		getInstrument( instrumentId ).lightEnable( groupName );
	},

	lightIsEnabled( instrumentId, groupName ) {
		getInstrument( instrumentId ).lightIsEnabled( groupName );
	},

	lightSetSetpoint( instrumentId, groupName, setpoint ) {
		getInstrument( instrumentId ).lightSetSetpoint( groupName, setpoint );
	},

	lightSetScaling( instrumentId, groupName, scaling ) {
		getInstrument( instrumentId ).lightSetScaling( groupName, scaling );
	}
};

