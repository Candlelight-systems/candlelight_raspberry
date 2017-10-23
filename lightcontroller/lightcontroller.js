'use strict';

//const HostManager					= require( "../hostmanager" );
const Waveform						= require( "jsgraph-waveform" );
const InstrumentController			= require('../instrumentcontroller' );

class LightController extends InstrumentController {

	constructor( ) {

		super( config );
		this.currentCode = 170;
		this.on = false;
	}

	init() {

		this.openConnection( async () => {

			await this.query( "PWM:VALUE:CH" + this.getInstrumentConfig().pwmChannel + " " + this.getInstrumentConfig().currentCode );
			await this.turnOn();
			this.checkLightStatus();
		} );
	}

	setTracker( tracker ) {
		this.trackerReference = tracker;
	}

	pause() {
		if( this._timeout ) {
			clearTimeout( this._timeout );
			this._timeout = false;
		}

		this.paused = true;
	}

	resume() {
		this.paused = false;
		this.checkLightStatus();
	}

	setInstrumentConfig( config ) {

		this.instrumentConfig = config;

		if( this.getInstrumentConfig().setPoint || this.getInstrumentConfig().setPoint === 0 ) {
			
			this.setPoint = this.getInstrumentConfig().setPoint;
			this._scheduling = undefined;

		} else if( this.getInstrumentConfig().scheduling ) {

			let rescalingMS;	
			this.setPoint = undefined;
			this._scheduling = {};

			if( this.getInstrumentConfig().scheduling.basis == '1day' ) {

				this._scheduling.msBasis = 3600 * 24 * 1000;

			} else if( this.getInstrumentConfig().scheduling.basis == '1hour' ) {

				this._scheduling.msBasis = 3600 * 1000;
			}

			let waveform = new Waveform( this.getInstrumentConfig().scheduling.intensities );
			waveform.rescaleX( 0, this._scheduling.msBasis / waveform.getLength() ); 

			this._scheduling.waveform = waveform;
			this._scheduling.startDate = Date.now();
		}
	}

	getSetPoint() {

		if( ! this.setPoint && this.setPoint !== 0 ) {
			
			if( ! this._scheduling ) {
				throw "Impossible to determine set point. Check scheduler and manual set point value"
			}

			let ellapsed = ( Date.now() - this._scheduling.startDate ) % this._scheduling.msBasis;

			const index = this._scheduling.waveform.getIndexFromX( ellapsed );
			
			return this._scheduling.waveform.getY( index );
		}

		if( this.setPoint > this.getInstrumentConfig().maxIntensity ) {

			return this.getInstrumentConfig().maxIntensity;

		} else if( this.setPoint > 0 && this.setPoint < 0.01 ) {

			return 0;
		}

		return this.setPoint;
	}

	async checkLightStatus( pauseChannels = true ) {

		if( this.paused ) {
			return;
		}

		var setPoint = this.getSetPoint();

		if( ! this.trackerReference ) {
			throw "No MPP Tracker reference from which to read the photodiode input";
		}

		if( ! this.getInstrumentConfig().pd ) {
			throw "No photodiode reference from which to read the light intensity";
		}

		if( this._timeout ) {
			clearTimeout( this._timeout );
			this._timeout = false;
		}


		if( setPoint === 0 ) {
			await this.turnOff();
			this.setTimeout();
			return;
		} else {
			await this.turnOn();
		}

		let pdData = this.trackerReference.getPDData( this.getInstrumentConfig().pd );
		let pdValue = this.trackerReference.getPDValue( this.getInstrumentConfig().pd ) * 1000;
		let sun = pdValue / pdData.scaling_ma_to_sun;

		if( Math.abs( sun - setPoint ) > 0.01 ) { // Above 1% deviation

			if( pauseChannels ) {
				await this.trackerReference.pauseChannels();
			}

			let codePerMa = ( 255 - this.getCurrentCode() ) / pdValue; // From the current value, get the code / current(PD) ratio
			let diffmA = pdValue - setPoint * pdData.scaling_ma_to_sun; // Calculate difference with target in mA
			let idealCodeChange = codePerMa * diffmA; // Get the code difference

			await this.setCode( this.getCurrentCode() + idealCodeChange ); // First correction based on linear extrapolation
			await this.delay( 300 );

			let i = 0;

			do {

				sun = ( await this.trackerReference._measurePD( this.getInstrumentConfig().pd ) ) * 1000 / pdData.scaling_ma_to_sun;

				if( Math.abs( sun - setPoint ) > 0.01 ) {

					if( sun < setPoint ) {
						await this.increaseCode();	
					}
					
					if( sun > setPoint ) {
						await this.decreaseCode();
					}

					i++;

				} else {
					break;
				}

			} while( i < 100 );

			if( pauseChannels ) {
				await this.trackerReference.resumeChannels();
			}
		}

		this.setTimeout();
	}

	setTimeout() {

		if( this._timeout ) {
			clearTimeout( this._timeout );
			this._timeout = false;
		}

		this._timeout = setTimeout( () => { this.checkLightStatus() }, 20000 );
	}

	increaseCode() {
		return this.setCode( this.getCurrentCode() - 1 );
	}

	decreaseCode() {
		return this.setCode( this.getCurrentCode() + 1 );
	}

	getCode() {
		return this.currentCode;
	}

	getCurrentCode() {
		return this.getCode();
	}

	setCode( newCode ) {
		this.currentCode = Math.min( Math.max( 0, Math.round( newCode ) ), 255 );
		return this.query( "PWM:VALUE:CH" + this.getInstrumentConfig().pwmChannel + " " + this.currentCode );
	}

	async turnOn() {
		if( this.on ) {
			return;
		}

		this.on = true;
		await this.query( "OUTPUT:ON:CH" + this.getInstrumentConfig().pwmChannel );

		await this.delay( 500 );
		await this.trackerReference._measurePD( this.getInstrumentConfig().pd )

	}

	turnOff() {
		if( ! this.on ) {
			return;
		}

		this.on = false;
		return this.query( "OUTPUT:OFF:CH" + this.getInstrumentConfig().pwmChannel );
	}
/*	

	query( ) {
		return this.host.query( ...arguments );
	}
*/
	delay( timeMS = 500 ) {
		return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, timeMS ) );
	}
}

module.exports = LightController;