
const InstrumentController = require("./instrumentcontroller");
let hosts = {};

module.exports = {

	addHost: ( config, alias ) => {

		if( ! alias && config.alias ) {
			alias = config.alias;
		}

		if( hosts[ alias ] ) {
			return hosts[ alias ];
		}

		hosts[ alias ] = new InstrumentController( config );
		return hosts[ alias ];
	},

	getHost: ( alias ) => {
		if( hosts[ alias ] ) {
			return hosts[ alias ];
		}

		throw "Host with alias " + alias + " does not exist.";
	}
};
