'use strict';

const InstrumentController			= require( "../instrumentcontroller" );
const Waveform						= require( "jsgraph-waveform" );

class LightController extends InstrumentController {

	constructor( config ) {

		super( ...arguments );

		this.currentCode = 0;
		this.setPoint = 0;

		this.setConfig( config );
		this.openConnection().then( () => {

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

				this._scheduling.msBasis = 3600 * 24;

			} else if( this.config.scheduling.basis == '1hour' ) {

				this._scheduling.msBasis = 3600;
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
			ellapsed = ellapsed - ( ellapsed % this._scheduling.msBasis );

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

		let pdData = this.trackerReference.getPDData( this.config.pdRef );
console.log( pdData );
		let pdValue = this.trackerReference.getPDValue( this.config.pdRef );
		console.log( pdValue );
		let sun = pdValue / pdData.scaling_ma_to_sun;
console.log( sun, setPoint );
		if( Math.abs( sun - setPoint ) > 0.01 ) { // Above 1% deviation

			await this.trackerReference.pauseChannels();

			let codePerMa = ( 255 - this.getCurrentCode() ) / pdValue; // From the current value, get the code / current(PD) ratio
			let diffmA = pdValue - setPoint * pdData.scaling_ma_to_sun; // Calculate difference with target in mA
			let idealCodeChange = codePerPDmA * diffmA; // Get the code difference

console.log( diffmA, idealCodeChange );

			await this.setCode( this.getCurrentCode() + idealCodeChange ); // First correction based on linear extrapolation
			await this.delay( 200 );


			do {

				sun = ( await this.trackerReference.measurePDValue( this.config.pdRef ) ) / pdData.scaling_ma_to_sun;

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

	setCode() {
		console.log( "PWM:VALUE:CH" + this.config.pwmChannel + " " + this.currentCode );
		return this.query( "PWM:VALUE:CH" + this.config.pwmChannel + " " + this.currentCode );
	}

	
}

module.exports = LightController;