'use strict';

//const HostManager					= require( "../hostmanager" );
const Waveform						= require( "jsgraph-waveform" );
const InstrumentController			= require('../instrumentcontroller' );

class LightController extends InstrumentController {

	constructor( config ) {

		super( config );

		this.currentCode = {};
		this.on = false;
		this.processedConfig = {};
		this.trackerReference = {};
	}

	init() {

		this.openConnection( async () => {

		//	await this.query( "PWM:VALUE:CH" + this.getInstrumentConfig().pwmChannel + " " + this.getInstrumentConfig().currentCode );
			//await this.turnOn();
		//	this.checkLightStatus();

			this.setTimeout();

		} );


	}

	async setTracker( tracker, groupName ) {
		this.trackerReference[ groupName ] = tracker;
		let cfg = this.getInstrumentConfig()[ groupName ];
		await this.query( "PWM:VALUE:CH" + cfg.pwmChannel + " " + this.currentCode[ groupName ] );
		await this.turnOn( groupName );
	}

	setGroupConfig( groupName, config ) {
		Object.assign( this.instrumentConfig[ groupName ], config ); // Extend it
		this.processConfig( groupName );
	}

	setInstrumentConfig( cfg ) {

		this.instrumentConfig = cfg;
		for( var i in cfg ) {
			this.processedConfig[ i ] = {};
			this.processConfig( i );
		}
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

	async processConfig( groupName ) {

		const cfg = this.getInstrumentConfig()[ groupName ];

		this.currentCode[ groupName ] = 170;

		if( cfg.setPoint || cfg.setPoint === 0 ) {
			
			this.setPoint = cfg.setPoint;
			this._scheduling = undefined;

		} else if( cfg.scheduling ) {

			let rescalingMS;	
			this.setPoint = undefined;
			this.processedConfig[ groupName ]._scheduling = {};

			if( cfg.scheduling.basis == '1day' ) {

				this.processedConfig[ groupName ]._scheduling.msBasis = 3600 * 24 * 1000;

			} else if( cfg.scheduling.basis == '1hour' ) {

				this.processedConfig[ groupName ]._scheduling.msBasis = 3600 * 1000;
			}

			let waveform = new Waveform( cfg.scheduling.intensities );
			waveform.rescaleX( 0, this._scheduling.msBasis / waveform.getLength() ); 

			this.processedConfig[ groupName ]._scheduling.waveform = waveform;
			this.processedConfig[ groupName ]._scheduling.startDate = Date.now();
		}
	}

	getSetPoint( groupName ) {

		const cfg = this.getInstrumentConfig()[ groupName ];

		if( ! cfg.setPoint && cfg.setPoint !== 0 ) {
			
			if( ! this.processedConfig[ groupName ]._scheduling ) {
				throw "Impossible to determine set point. Check scheduler and manual set point value"
			}

			let ellapsed = ( Date.now() - this.processedConfig[ groupName ]._scheduling.startDate ) % this.processedConfig[ groupName ]._scheduling.msBasis;

			const index = this.processedConfig[ groupName ]._scheduling.waveform.getIndexFromX( ellapsed );
			
			return this.processedConfig[ groupName ]._scheduling.waveform.getY( index );
		}


		if( cfg.setPoint > cfg.maxIntensity ) {

			return cfg.maxIntensity;

		} else if( cfg.setPoint > 0 && cfg.setPoint < 0.01 ) {

			return 0;
		}

		return cfg.setPoint;
	}

	async checkLightStatus( pauseChannels = true ) {

		if( this.paused ) {
			return;
		}

		for( var i in this.getInstrumentConfig() ) {

			let groupName = i;

			if( ! this.getInstrumentConfig()[ i ].modeAutomatic ) {
				return;
			}
			
			if( this.getInstrumentConfig()[ i ].outputPower !== undefined ) {
				await this.setCode( groupName, Math.round( 255 - this.getInstrumentConfig()[ i ].outputPower * 255 ) );
				return;
			}

			let setPoint = this.getSetPoint( i );
			let pd = this.getInstrumentConfig()[ i ].pd;
			let trackerReference = this.trackerReference[ groupName ];

			if( ! trackerReference ) {
				throw "No MPP Tracker reference from which to read the photodiode input";
			}

			if( ! pd ) {
				throw "No photodiode reference from which to read the light intensity";
			}

			if( this._timeout ) {
				clearTimeout( this._timeout );
				this._timeout = false;
			}

			if( setPoint === 0 ) {
				await this.turnOff( i );
				this.setTimeout();
				return;
			} else {
				await this.turnOn( i );
			}

			let pdData = trackerReference.getPDData( pd );
			let pdValue = trackerReference.getLightIntensity( pd );

			let sun = pdValue;

			if( Math.abs( sun - setPoint ) > 0.01 ) { // Above 1% deviation

				if( pauseChannels ) {
					await trackerReference.pauseChannels();
				}

				let codePerSun = ( 255 - this.getCurrentCode( groupName ) ) / pdValue; // From the current value, get the code / current(PD) ratio
				let diffSun = pdValue - setPoint; // Calculate difference with target in sun
				let idealCodeChange = codePerSun * diffSun; // Get the code difference

				await this.setCode( groupName, this.getCurrentCode( groupName ) + idealCodeChange ); // First correction based on linear extrapolation
				await this.delay( 300 );

				let i = 0;

				do {

				sun = ( await trackerReference._measurePD( pd ) ) * pdData.scaling_ma_to_sun;

					if( Math.abs( sun - setPoint ) > 0.01 ) {

						if( sun < setPoint ) {
							await this.increaseCode( groupName );	
						}
						
						if( sun > setPoint ) {
							await this.decreaseCode( groupName );
						}

						i++;

					} else {
						break;
					}

				} while( i < 100 );

				if( pauseChannels ) {
					await trackerReference.resumeChannels();
				}
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

	increaseCode( groupName ) {
		return this.setCode( groupName, this.getCurrentCode( groupName ) - 1 );
	}

	decreaseCode( groupName ) {
		return this.setCode( groupName, this.getCurrentCode( groupName ) + 1 );
	}

	getCode( groupName ) {
		return this.currentCode[ groupName ];
	}

	getCurrentCode( groupName ) {
		return this.getCode( groupName );
	}

	setCode( newCode ) {
		this.currentCode = Math.min( Math.max( 0, Math.round( newCode ) ), 255 );
		return this.query( "PWM:VALUE:CH" + this.getInstrumentConfig().pwmChannel + " " + this.currentCode );

	}

	async turnOn( groupName ) {
		if( this.on ) {
			return;
		}

		const cfg = this.getInstrumentConfig()[ groupName ];

		this.on = true;
		await this.query( "OUTPUT:ON:CH" + cfg.pwmChannel );
		
		await this.delay( 500 );

		if( this.trackerReference[ groupName ] ) {
			await this.trackerReference[ groupName ]._measurePD( cfg.pd )
		}

	}

	turnOff( groupName ) {

		if( ! this.on ) {
			return;
		}

		const cfg = this.getInstrumentConfig()[ groupName ];

		this.on = false;

		return this.query( "OUTPUT:OFF:CH" + cfg.pwmChannel );
	}

	isModeAutomatic( groupName ) {
		const cfg = this.getInstrumentConfig()[ groupName ];
		return cfg.modeAutomatic;
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
