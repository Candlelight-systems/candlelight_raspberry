
const TrackerInstrument = require("./trackerinstrument");
const { matahari } = require("../config");

let instrumentInstances = {};

for( var i = 0; i < matahari.instruments.length; i ++ ) {

	instrumentInstances[ matahari.instruments[ i ].instrumentId ] = new TrackerInstrument( matahari.instruments[ i ] );
}

function getInstrument( instrumentId ) {

	if( ! instrumentInstances[ instrumentId ] ) {
		throw "The instrument with id " + instrumentId + " does not exist";
	}

	return instrumentInstances[ instrumentId ];
}

module.exports = {

	getChannels: function() {

		let channels = [];
		for( let key in instrumentInstances ) {
			channels = channels.concat( instrumentInstances[ key ].getChannels() );
		}

		return channels;
	},

	getStatus: function( instrumentId, chanId ) {

		let instrument = getInstrument( instrumentId ),
			channels = instrument.getChannels(),
			returnObject = {};

		channels.forEach( ( channel ) => {
			returnObject[ channel.chanId ] = instrument.getStatus( channel.chanId );
		});
	},

	executeIV: function( instrumentId, chanId ) {
		return getInstrument( instrumentId ).makeIV( chanId );
	},

	measureVoc: function( instrumentId, chanId ) {
		return getInstrument( instrumentId ).measureVoc( chanId );
	},

	measureJsc: function( instrumentId, chanId ) {
		return getInstrument( instrumentId ).measureJsc( chanId );
	},

	pauseChannels: function( instrumentId ) {
		return getInstrument( instrumentId ).pauseChannels();
	},

	resumeChannels: function( instrumentId ) {
		return getInstrument( instrumentId ).resumeChannels();
	},

	saveStatus: function( instrumentId, chanId, status ) {
		return getInstrument( instrumentId ).saveStatus( chanId, status );
	}
};

