
const InstrumentController 		= require("./instrumentcontroller");

let hosts = {};

module.exports = {

	addHost: ( config, alias, constructor ) => {

		if( ! alias && config.alias ) {
			alias = config.alias;
		}

		if( hosts[ alias ] ) {
			return hosts[ alias ];
		}

		let controller;

		controller = new constructor( config )
		hosts[ alias ] = controller;
		return hosts[ alias ];
	},

	getHost: ( alias ) => {

		if( hosts[ alias ] ) {
			return hosts[ alias ];
		}

		throw "Host with alias " + alias + " does not exist.";
	}
};
