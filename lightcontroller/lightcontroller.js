'use strict';

//const HostManager					= require( "../hostmanager" );
const Waveform						= require( 'jsgraph-waveform' );
const InstrumentController			= require( '../instrumentcontroller' );
const extend  						= require( 'extend' );

class LightController extends InstrumentController {

	constructor( config ) {

		super( ...arguments );

		this.currentCode = {};
		this.on = false;
		
		this.trackerReference = {};
	}

	init() {

		this.openConnection( async () => {

		//	await this.query( "PWM:VALUE:CH" + this.getInstrumentConfig().pwmChannel + " " + this.getInstrumentConfig().currentCode );
			//await this.turnOn();
		//	this.checkLightStatus();

			//await this.checkLightStatus();
			this.setTimeout();


		} );


	}

	async setTracker( tracker, groupName ) {

		this.trackerReference[ groupName ] = tracker;
	}

	async setGroupConfig( groupName, config ) {
		extend( true, this.instrumentConfig[ groupName ], config ); // Extend it
		this.processConfig( groupName );
	}

	setInstrumentConfig( cfg ) {

		this.instrumentConfig = cfg;
		for( var i in cfg ) {
			this.setGroupConfig( i, cfg[ i ] );
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

		if( cfg.scheduling.enable ) {

			let rescalingMS;	
			this.setPoint = undefined;
			this.getInstrumentConfig()[ groupName ].scheduling = this.getInstrumentConfig()[ groupName ].scheduling || {};

			
			//this.getInstrumentConfig()[ groupName ].scheduling.waveform = waveform;
			this.getInstrumentConfig()[ groupName ].scheduling.startDate = Date.now();

		} else if( cfg.setPoint || cfg.setPoint === 0 ) {
			
			this.setPoint = cfg.setPoint;
			this.scheduling = undefined;

		}
	}

	getSetPoint( groupName ) {

		const cfg = this.getInstrumentConfig()[ groupName ];

		if( ! cfg.setPoint && cfg.setPoint !== 0 ) {
			
			if( ! this.getInstrumentConfig()[ groupName ].scheduling ) {
				throw "Impossible to determine set point. Check scheduler and manual set point value"
			}

			let basis;
			switch( this.getInstrumentConfig()[ groupName ].scheduling.basis ) {
				case '1day':
					basis = 24 * 3600 * 1000;
				break;

				case '1hour':
					basis = 3600 * 1000;
				break;
			}

			this.getInstrumentConfig()[ groupName ].scheduling.startDate = this.getInstrumentConfig()[ groupName ].scheduling.startDate || Date.now();

			let ellapsed = ( ( Date.now() - this.getInstrumentConfig()[ groupName ].scheduling.startDate ) % basis ) / basis;
			let wave = new Waveform().setData( this.getInstrumentConfig()[ groupName ].scheduling.intensities );
			wave.rescaleX( 0, 1 / wave.getLength() ); 

			
			const index = wave.getIndexFromX( ellapsed );
		
			return wave.getY( index );
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
				await this.turnOn( groupName );
				return;
			}
			
			if( this.getInstrumentConfig()[ i ].outputPower !== undefined ) {
				await this.setCode( groupName, Math.round( 255 - this.getInstrumentConfig()[ i ].outputPower * 255 ) );
				continue;
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
				continue;
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

				let calibration = this.getInstrumentConfig()[ groupName ].calibration;
				let w = new Waveform();
				w.append( ...calibration[ 0 ] );
				w.append( ...calibration[ 1 ] );

				let idealCode = w.interpolate( sun );
				await this.setCode( groupName, idealCode ); // First correction based on linear extrapolation
				await this.delay( 300 );

				let i = 0;

				do {


					if( ! this.getInstrumentConfig()[ groupName ].modeAutomatic ) {
						await this.turnOn( groupName );
						return;
					}
					
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

					if( this.getCurrentCode( groupName ) == 255 || this.getCurrentCode( groupName ) == 0 ) {
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

	setCode( groupName, newCode ) {
		this.currentCode[ groupName ] = Math.min( Math.max( 0, Math.round( newCode ) ), 255 );
		return this.query( "PWM:VALUE:CH" + this.getInstrumentConfig()[ groupName ].pwmChannel + " " + this.currentCode[ groupName ] );

	}

	async turnOn( groupName ) {
		if( this.on ) {
			return;
		}

		const cfg = this.getInstrumentConfig()[ groupName ];

		if( ! cfg.pwmChannel ) {
			throw new Error("No PWM channel for this controller");
		}

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
