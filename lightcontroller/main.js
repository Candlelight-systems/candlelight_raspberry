
const HostManager 			= require("../hostmanager");
const { lightControllers } 	= require("../config");
const fs					= require('fs');
const config					= require("../config");

const LightController 		= require("./lightcontroller");


let instrumentInstances = {};


for( var i = 0; i < config.hosts.length; i ++ ) {
	
	if( config.hosts[ i ].constructorName == "LightController" ) {

		let host = HostManager.addHost( config.hosts[ i ], undefined, RelayController );	
		instrumentInstances[ config.hosts[ i ].alias ] = host;
		host.setInstrumentConfig( lightControllers.hosts[ config.hosts[ i ].alias ] );
		host.init();
	}
}


