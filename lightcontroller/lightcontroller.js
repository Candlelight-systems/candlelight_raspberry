'use strict';

const InstrumentController			= require( "../instrumentcontroller" );
const Waveform						= require( "jsgraph-waveform" );

class LightController extends InstrumentController {

	constructor( config ) {

		super( ...arguments );

		this.currentCode = 170;
		this.on = false;

		this.setConfig( config );
		this.openConnection().then( async () => {

			await this.query( "PWM:VALUE:CH" + this.config.pwmChannel + " " + this.currentCode );
			await this.turnOn();
			this.checkLightStatus();
		});
	}

	setTracker( tracker ) {
		this.trackerReference = tracker;
	}

	setConfig( config ) {

		this.config = config;

		if( this.scheduler ) {
			removeInterval( this.scheduler );
		}

		if( this.config.setPoint ) {
			
			this.setPoint = this.config.setPoint;
			this._scheduling = undefined;

		} else if( this.config.scheduling ) {

			let rescalingMS;	
			this.setPoint = undefined;
			this._scheduling = {};

			if( this.config.scheduling.basis == '1day' ) {

				this._scheduling.msBasis = 3600 * 24 * 1000;

			} else if( this.config.scheduling.basis == '1hour' ) {

				this._scheduling.msBasis = 3600 * 1000;
			}

			let waveform = new Waveform( this.config.scheduling.intensities );
			waveform.rescaleX( 0, this._scheduling.msBasis / waveform.getLength() ); 

			this._scheduling.waveform = waveform;
			this._scheduling.startDate = Date.now();
		}
	}

	getSetPoint() {

		if( this.setPoint === undefined ) {
			
			if( ! this._scheduling ) {
				throw "Impossible to determine set point. Check scheduler and manual set point value"
			}

			let ellapsed = ( Date.now() - this._scheduling.startDate );
			
			ellapsed = ellapsed - ( ellapsed % this._scheduling.msBasis / this._scheduling.waveform.getLength() );

			const index = this._scheduling.waveform.getIndexFromX( ellapsed );
			
			return this._scheduling.waveform.getY( index );
		}

		if( this.setPoint > this.config.maxIntensity ) {

			return this.config.maxIntensity;

		} else if( this.setPoint > 0 && this.setPoint < 0.01 ) {

			return 0;
		}
	}

	async checkLightStatus() {

		var setPoint = this.getSetPoint();

		if( ! this.trackerReference ) {
			throw "No MPP Tracker reference from which to read the photodiode input";
		}

		if( ! this.config.pdRef ) {
			throw "No photodiode reference from which to read the light intensity";
		}

		if( setPoint == 0 ) {
			await this.turnOff();
			this.setTimeout();
			return;
		} else {
			await this.turnOn();
		}

		let pdData = this.trackerReference.getPDData( this.config.pdRef );
		let pdValue = this.trackerReference.getPDValue( this.config.pdRef ) * 1000;
		let sun = pdValue / pdData.scaling_ma_to_sun;

		if( Math.abs( sun - setPoint ) > 0.01 ) { // Above 1% deviation
console.log( diffMa, sun, setPoint, pdValue );
			await this.trackerReference.pauseChannels();

			let codePerMa = ( 255 - this.getCurrentCode() ) / pdValue; // From the current value, get the code / current(PD) ratio
			let diffmA = pdValue - setPoint * pdData.scaling_ma_to_sun; // Calculate difference with target in mA
			let idealCodeChange = codePerMa * diffmA; // Get the code difference

			await this.setCode( this.getCurrentCode() + idealCodeChange ); // First correction based on linear extrapolation
			await this.delay( 300 );

			let i = 0;

			do {

				sun = ( await this.trackerReference.measurePD( this.config.pdRef ) ) * 1000 / pdData.scaling_ma_to_sun;

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

			await this.trackerReference.resumeChannels();
		}

		this.setTimeout();
	}

	setTimeout() {
		setTimeout( () => { this.checkLightStatus() }, 20000 );
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
		console.log( "PWM:VALUE:CH" + this.config.pwmChannel + " " + this.currentCode );
		return this.query( "PWM:VALUE:CH" + this.config.pwmChannel + " " + this.currentCode );
	}

	async turnOn() {
		if( this.on ) {
			return;
		}

		this.on = true;
		await this.query( "OUTPUT:ON:CH" + this.config.pwmChannel );

		await this.delay( 500 );
		await this.trackerReference.measurePD( this.config.pdRef )

	}

	turnOff() {
		if( ! this.on ) {
			return;
		}

		this.on = false;
		return this.query( "OUTPUT:OFF:CH" + this.config.pwmChannel );
	}
	
}

module.exports = LightController;