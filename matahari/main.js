
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

	getInstruments() {
		return matahari.trackers.map( ( tracker ) => {
			return tracker;
		});
	},

	getChannels: ( instrumentId ) => {

		return getInstrument( instrumentId ).getChannels();
	},

	getStatus: ( instrumentId, chanId ) => {

		chanId = parseInt( chanId );
		
		let instrument = getInstrument( instrumentId ),
			channels = instrument.getChannels(),
			returnObject = {};

		channels.forEach( ( channel ) => {

			if( chanId && chanId !== channel.chanId ) {
				return;
			}

			returnObject[ channel.chanId ] = instrument.getStatus( channel.chanId );
		});

		return returnObject;
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
	},

	setVoltage: ( instrumentId, chanId, voltage ) => {
		return getInstrument( instrumentId ).setVoltage( chanId, voltage );
	},

	measureCurrent: ( instrumentId, chanId, voltage ) => {

		let instrument = getInstrument( instrumentId );
		if( chanId == 'pd1' ) {
			return instrument.measurePD1();
		} else if( chanId == 'pd2' ) {
			return instrument.measurePD2();
		} else {
			return instrument.measureCurrent( chanId );
		}
	},

	enableChannel: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).enableChannel( chanId );
	},

	disableChannel: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).disableChannel( chanId );
	}
};

