
const TrackerInstrument = require("./trackerinstrument");
const { matahari } = require("../config");

let instrumentInstances = {};

for( var i = 0; i < matahari.trackers.length; i ++ ) {

	instrumentInstances[ matahari.trackers[ i ].instrumentId ] = new TrackerInstrument( matahari.trackers[ i ] );
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

	getStatus: ( instrumentId, chanId ) => {

		let instrument = getInstrument( instrumentId ),
			channels = instrument.getChannels(),
			returnObject = {};

		channels.forEach( ( channel ) => {

			if( chanId && chanId !== channel.chanId ) {
				return;
			}

			returnObject[ channel.chanId ] = instrument.getStatus( channel.chanId );
		});
	},

	getPDOptions: ( instrumentId ) => {
		return getInstrument( instrumentId ).getPDOptions();
	},

	executeIV: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).makeIV( chanId );
	},

	measureVoc: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).measureVoc( chanId );
	},

	measureJsc: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).measureJsc( chanId );
	},

	pauseChannels: ( instrumentId ) => {
		return getInstrument( instrumentId ).pauseChannels();
	},

	resumeChannels: ( instrumentId ) => {
		return getInstrument( instrumentId ).resumeChannels();
	},

	saveStatus: ( instrumentId, chanId, status ) => {
		return getInstrument( instrumentId ).saveStatus( chanId, status );
	},

	resetStatus: ( instrumentId, chanId, status ) => {
		return getInstrument( instrumentId ).resetStatus( chanId, status );
	}
};

