
const HostManager 			= require("../hostmanager");
const { lightControllers } 	= require("../config");
const fs					= require('fs');
const config					= require("../config");

const LightController 		= require("./lightcontroller");


let instrumentInstances = {};


for( var i = 0; i < config.hosts.length; i ++ ) {
	
	if( config.hosts[ i ].constructorName == "LightController" ) {

		let host = HostManager.addHost( config.hosts[ i ], undefined, LightController );	
		instrumentInstances[ config.hosts[ i ].alias ] = host;

		host.setInstrumentConfig( lightControllers.hosts[ config.hosts[ i ].alias ] );
		host.init();
	}
}


function getInstrument( alias ) {

	if( instrumentInstances[ alias ] ) {
		return instrumentInstances[ alias ];
	}

	return;
}


module.exports = {

	setGroupConfig: ( controllerName, groupName, cfg ) => {

		const instrument = getInstrument( controllerName );

		if( ! instrument ) {
			throw "Instrument doesn't exist. Controller name is " + controllerName;
		}
		
		instrument.setGroupConfig( groupName, cfg );

		//lightControllers.hosts[ controllerName ][ groupName ] = cfg;
		
		fs.writeFileSync( './config/lightControllers.json', JSON.stringify( lightControllers.hosts ) );
	}
}
