
const TrackerInstrument = require("./trackerinstrument");
const { matahari } = require("../config");
const fs  = require('fs');

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

	getChannels: ( instrumentId, groupName ) => {

		return getInstrument( instrumentId ).getChannels( groupName );
	},


	getGroups: ( instrumentId ) => {

		return getInstrument( instrumentId ).getGroups();
	},

	getStatus: ( instrumentId, chanId ) => {

		chanId = parseInt( chanId );
		
		let instrument = getInstrument( instrumentId ),
			groups = instrument.getGroups(),
			returnObject = {};;

		groups.forEach( ( group ) => {

			returnObject[ group.groupName ] = {
				channels: {}
			};

			if( instrument.hasLightController( group.groupName ) ) {
				returnObject[ group.groupName ].lightController = true;
				returnObject[ group.groupName ].lightSetpoint = instrument.getLightController( group.groupName ).getSetPoint();
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
		fs.writeFileSync('./config/trackers.json', JSON.stringify( matahari.trackers, undefined, "\t" ) );
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

	setVoltage: async ( instrumentId, chanId, voltage ) => {
		await getInstrument( instrumentId ).saveStatus( chanId, { tracking_mode: 0 } );
		await getInstrument( instrumentId ).setVoltage( chanId, voltage );
	},

	measureCurrent: ( instrumentId, chanId, voltage ) => {

		let instrument = getInstrument( instrumentId );
		if( chanId.indexOf( 'pd' ) > -1 ) {

			return instrument._measurePD( chanId );

		} else {

			return instrument.measureCurrent( chanId );
		}
	},

	enableChannel: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).enableChannel( chanId );
	},

	disableChannel: ( instrumentId, chanId ) => {
		return getInstrument( instrumentId ).disableChannel( chanId );
	},

	getLightController: async ( instrumentId, groupName ) => {
		
		let instrument = getInstrument( instrumentId );

		if( instrument.hasLightController( groupName ) ) {
			return getInstrument( instrumentId ).getLightControllerConfig( groupName );
		}
		
		throw "This instrument has no light controller";
	},

	saveLightController: async ( instrumentId, groupName, controller ) => {
		let savingPromise = getInstrument( instrumentId ).saveLightController( groupName, controller );
		fs.writeFileSync('./config/trackers.json', JSON.stringify( matahari.trackers, undefined, "\t" ) );
		return savingPromise;
	}
};

