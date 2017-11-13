
const HostManager = require("../hostmanager");
const { relayControllers } = require("../config");
const fs  = require('fs');
const config					= require("../config");
const RelayController 		= require("./relaycontroller");

let instrumentInstances = {};


for( var i = 0; i < config.hosts.length; i ++ ) {
	
	if( config.hosts[ i ].constructorName == "RelayController" ) {

		let host = HostManager.addHost( config.hosts[ i ], undefined, RelayController );	
		instrumentInstances[ config.hosts[ i ].alias ] = host;
		host.setInstrumentConfig( relayControllers.hosts[ config.hosts[ i ].alias ] );
		host.init();
	}
}


function getInstrument( alias ) {
	if( instrumentInstances[ alias ] ) {
		return instrumentInstances[ alias ];
	}

	throw `Instrument (relay controller) with alias "${ alias }" does not exist`;
}

module.exports = {

	enableRelay( hostAlias, chanId ) {
		getInstrument( hostAlias ).enableRelay( chanId );
	},

	disableRelay( hostAlias, chanId ) {
		getInstrument( hostAlias ).disableRelay( chanId );
	}
}