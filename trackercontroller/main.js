
const fs 						= require('fs');
const HostManager 				= require("../hostmanager");
const config					= require("../config");
const { trackerControllers } 	= require("../config");
const TrackerController 		= require("./trackercontroller");
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

function save() {
	fs.writeFileSync('./config/trackerControllers.json', JSON.stringify( trackerControllers.hosts, undefined, "\t" ) );
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
			returnObject = {
			};

		groups.forEach( ( group ) => {

			returnObject[ group.groupName ] = {
				acquisitionSpeed: instrument.getAcquisitionSpeed(),
				channels: {}
			};

			if( group.heat || group.heatController ) {
				returnObject[ group.groupName ].heatController = true;
//				returnObject[ group.groupName ].heatingPower = instrument.getHeatingPower( group.groupName );
			}

			if( group.light ) {
				returnObject[ group.groupName ].lightController = true;
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

	measureCurrent: ( instrumentId, chanNumber ) => {

		const chanId = lookupChanId( instrumentId, chanNumber );
		let instrument = getInstrument( instrumentId );
		//let group = instrument.getGroupFromGroupName( groupName );
		
		//if( ! group.light ) {
		//	throw "This group has no light";
		//}

		if( chanNumber.indexOf( '_pd' ) > -1 ) {
		//	return instrument.measurePDCurrent( group.light.channelId );
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

	setAcquisitionSpeed( instrumentId, speed ) {
		return getInstrument( instrumentId ).setAcquisitionSpeed( speed );
	},

	dcdcEnable: async( instrumentId, groupName, power ) => {
		let instrument = getInstrument( instrumentId );
		await instrument.dcdcEnable( groupName, power );
		await save();
	},
	
	dcdcDisable: async( instrumentId, groupName, power ) => {
		let instrument = getInstrument( instrumentId );
		await instrument.dcdcDisable( groupName, power );
		await save();
	},

	increaseDCDCPower: async( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return await instrument.increaseDCDCPower( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	decreaseDCDCPower: async( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return await instrument.decreaseDCDCPower( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	heatSetTarget: async( instrumentId, groupName, target ) => {
		await getInstrument( instrumentId ).heatSetTarget( groupName, target );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	heatSetHeating: async ( instrumentId, groupName ) => {
		await getInstrument( instrumentId ).heatSetHeating( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},


	heatSetMode: async ( instrumentId, groupName, mode ) => {
		await getInstrument( instrumentId ).heatSetMode( groupName, mode );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	heatSetCooling: async ( instrumentId, groupName ) => {
		await getInstrument( instrumentId ).heatSetCooling( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	heatSetPower: async ( instrumentId, groupName, power ) => {
		await getInstrument( instrumentId ).heatSetPower( groupName, power );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	heatGetTemperature: ( instrumentId, groupName ) => {
		return getInstrument( instrumentId ).heatGetTemperature( groupName );

	},


	heatGetPIDParameters: ( instrumentId, groupName ) => {
		return getInstrument( instrumentId ).heatGetPIDParameters( groupName );
	},

	heatSetPIDParameters: ( instrumentId, groupName, parameters ) => {
		return getInstrument( instrumentId ).heatSetPIDParameters( groupName, parameters );
	},

	getAllMeasurements: () => {
		return allMeasurements;
	},

	getMeasurement: ( measurementName ) => {
		return allMeasurements[ measurementName ];
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


	getLightControl: ( instrumentId, groupName ) => {
		let instrument = getInstrument( instrumentId );
		return instrument.lightGetControl( groupName );		
	},

	setLightControl: async ( instrumentId, groupName, cfg ) => {
		await getInstrument( instrumentId ).lightSetControl( groupName, cfg );
		await save();
	},

	async lightDisable( instrumentId, groupName ) {
	
		await getInstrument( instrumentId ).lightDisable( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	async lightEnable( instrumentId, groupName ) {
	
		await getInstrument( instrumentId ).lightEnable( groupName );
		await getInstrument( instrumentId ).measureEnvironment();
		await save();
	},

	lightIsEnabled( instrumentId, groupName ) {
		return getInstrument( instrumentId ).lightIsEnabled( groupName );
	},

	lightSetSetpoint( instrumentId, groupName, setpoint ) {
		getInstrument( instrumentId ).lightSetSetpoint( groupName, setpoint );
		save();
	},

	lightSetScaling( instrumentId, groupName, scaling ) {
		getInstrument( instrumentId ).lightSetScaling( groupName, scaling );
		save();
	},


	lightSetPyranometerScaling( instrumentId, groupName, scale, offset ) {
		const group = getInstrument( instrumentId ).getGroupFromGroupName( groupName );

		if( group.light && group.light.type == 'pyranometer_4_20mA' ) {

			group.light.scaling = scale;
			group.light.offset = offset;
			save();
			return;
		}

		throw "No pyranometer for this group";
	},

	lightGetPyranometerScaling( instrumentId, groupName, scaling ) {
		const group = getInstrument( instrumentId ).getGroupFromGroupName( groupName );
		
		if( group.light && group.light.type == 'pyranometer_4_20mA') {
			return {
				scale: group.light.scaling,
				offset: group.light.offset
			}
		}

		throw "No pyranometer for this group";
	}
};

