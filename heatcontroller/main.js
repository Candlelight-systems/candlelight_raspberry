
const HostManager = require("../hostmanager");
const { heatControllers } = require("../config");
const fs  = require('fs');
const HeatController 		= require("./heatcontroller");
const config					= require("../config");

let instrumentInstances = {};

for( var i = 0; i < config.hosts.length; i ++ ) {
	
	if( config.hosts[ i ].constructorName == "HeatController" ) {

		let host = HostManager.addHost( config.hosts[ i ], undefined, HeatController );	
		instrumentInstances[ config.hosts[ i ].alias ] = host;
		host.setInstrumentConfig( heatControllers.hosts[ config.hosts[ i ].alias ] );
		host.init();
	}
}

function getInstrument( alias ) {
	if( instrumentInstances[ alias ] ) {
		return instrumentInstances[ alias ];
	}

	throw `Instrument (heat controller) with alias "${ alias }" does not exist`;
}


module.exports = {

	setPower: ( instrumentId, power, channel ) => {
		// Power should be in percentage
		getInstrument( instrumentId ).setPower( power, channel );
	},

	getPower: ( instrumentId, channel ) => {
		return getInstrument( instrumentId ).getPower( channel );	
	}
}