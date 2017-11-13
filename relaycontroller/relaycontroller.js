'use strict';

const InstrumentController			= require('../instrumentcontroller' );

class RelayController extends InstrumentController {

	constructor( config ) {
		super( config );
	}

	init() {

		this.openConnection( async () => {
		} );
	}

	enableRelay( chanId ) {

		this.query("RELAY:ON " + chanId );
	}

	disableRelay( chanId ) {

		this.query("RELAY:OFF " + chanId );
	}
}

module.exports = RelayController;