'use strict';

const InstrumentController			= require('../instrumentcontroller' );

const maxVoltage = 20; // 20V max !

class HeatController extends InstrumentController {

	constructor( config ) {

		super( config );
		this.trackerReference = {};
		this.resistorCode = {
			1: -1,
			2: -1,
			3: -1,
			4: -1
		}

		this.nominalPower = {
			1: 0,
			2: 0,
			3: 0,
			4: 0
		}
	}

	init() {

		this.openConnection( async () => {
		} );
	}


	async setTracker( tracker, groupName ) {
		this.trackerReference[ groupName ] = tracker;
	}

	async setPower( groupName, power ) {

		let channel = this.getInstrumentConfig()[ groupName ].channel;
		if( power > 1 ) {
			power = 1;
		}

		if( power < 0 ) {
			power = 0;
		}

		const setVoltage = power * maxVoltage;
		let rbottom = 0.75 * 82000 / ( setVoltage - 0.75 );
		rbottom = 50000 - rbottom;
		let rbottomcode = Math.round( rbottom / 50000 * 256 );

		this.nominalPower[ channel ] = power;

		if( rbottomcode < 0 ) {
			rbottomcode = 0;
		} else if( rbottomcode > 255 ) {
			rbottomcode = 255;
		}

		this.getInstrumentConfig()[ groupName ].value = power;

		if( setVoltage < 1 ) {
			//await this.turnOff( channel );
			this.resistorCode[ channel ] = -1;
		} else {
			//await this.turnOn( channel );
			this.resistorCode[ channel ] = rbottomcode;
			await this.setValue( groupName, this.resistorCode[ channel ] );
		}
	}

	getPower( groupName ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		if( this.resistorCode[ channel ] < 0 ) {
			return -1;
		}

		return  ( 82000 / ( ( 255 - this.resistorCode[ channel ] ) / 255 * 50000 ) * 0.75 - 0.75 ) / maxVoltage;
	}

	async increasePower( groupName, increment = 0.05 ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		increment = Math.max( 0, Math.min( 1, increment ) );
		this.nominalPower[ channel ] += increment; // Add 1 percent
		return this.setPower( groupName, this.nominalPower[ channel ] );
	}

	async decreasePower( groupName, increment = 0.05 ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		increment = Math.max( 0, Math.min( 1, increment ) );
		this.nominalPower[ channel ] -= increment; // Add 1 percent
		return this.setPower( groupName, this.nominalPower[ channel ] );
	}

	async turnOff( groupName ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		this.getInstrumentConfig()[ groupName ].on = false;
		await this.setPower( groupName, 0 );
		return this.query("DCDC:DISABLE:CH" + channel );
	}

	async turnOn( groupName ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		this.getInstrumentConfig()[ groupName ].on = true;
		await this.setPower( groupName, 0 );
		return this.query("DCDC:ENABLE:CH" + channel );
	}

	async setValue( groupName, value ) {
		let channel = this.getInstrumentConfig()[ groupName ].channel;
		return this.query("DCDC:VALUE:CH" + channel + " " + value );	
	}
}

module.exports = HeatController;