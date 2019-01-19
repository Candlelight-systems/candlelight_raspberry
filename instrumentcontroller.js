
const serialport 	= require("serialport");
const queryManager	= require("./queryhandler")
const rpio 			= require("rpio");
const wsconnection	= require('./wsconnection' );

let resetted = false;
class InstrumentController {


	constructor( config ) {

		this.communicationConfig = config;

		this.managers = {
			'state': new queryManager()
		}


		if( this.communicationConfig.resetPin ) {

			console.log('Preparing', this.communicationConfig.resetPin);
			rpio.open( this.communicationConfig.resetPin, rpio.OUTPUT, rpio.LOW );

		}
	}

	setInstrumentConfig( config ) {
		this.instrumentConfig = config;
	}

	getInstrumentConfig( ) {

		if( ! this.instrumentConfig ) {
			throw "No instrument configuration was defined. Check that the host file name corresponds to the trackerController.json file";
		}
		return this.instrumentConfig;
	}

	lease( callback ) {


		let communication = this.connection;


		return communication.queryManager.addQuery( async () => {

			// The query can fail, in which case we should keep going.
			// Hence the try catch
			try {
				await communication.lease;
			} catch( e ) {}

			// Wait for the lease the be released
			return communication.lease = new Promise( async ( resolver, rejecter ) => {

				await callback();
				resolver();
			} );
		} );

	}

	query( query, linesExpected = 1, executeBefore = undefined, prepend = false, rawOutput = false, expectedBytes = 0 ) {

		let communication = this.connection;

		if( query === undefined ) {
			console.trace();
			return;
		}

		if( ! communication.isOpen ) {
			return new Promise( ( resolver, rejecter ) => rejecter( "Port is closed" ) );
		}

		//return new Promise( ( resolver ) => resolver() );

		let queryString;
		let queryTimeout;
		let queryAfterWait;

		if( typeof query == "object" ) {
			queryString = query.string;
			queryTimeout = query.timeout;
			queryAfterWait = query.waitAfter;
		} else {
			queryString = query;
			queryTimeout = 1000;
			queryAfterWait = 10;
		}

		queryTimeout = queryTimeout || 1000; // Default to 1 second

		if( ! communication ) {
			throw "Could not find communication based on the instrument id";
		}

		return communication.queryManager.addQuery( async () => {

			// The query can fail, in which case we should keep going.
			// Hence the try catch
			try {
				await communication.lease;
			} catch( e ) {}

			if( executeBefore ) {
				if( ! executeBefore() ) {
					throw "Cannot execute method. Forbidden";
				}
			}

			// Wait for the lease the be released
			return communication.lease = new Promise( ( resolver, rejecter ) => {

				let data = Buffer.alloc(0),
				dOut = [],
				lineCount = 0,
				timeout = setTimeout( () => {

					console.error(`Query ${ queryString } has timed out (${ queryTimeout } ms).`);

					wsconnection.send( {

						instrumentId: this.getInstrumentId(),
						log: {
							type: 'error',
							message: `Query ${ queryString } has timed out (${ queryTimeout } ms).`
						}
					} );

//					this.query("*RST");
					rejecter(); // Reject the current promise
				//	this.reset(); // Reset the instrument
				}, queryTimeout );

				// Start by remove all listeners
				communication.removeAllListeners( "data" );

				// Listening
				communication.on( "data", async ( d ) => {

					data = Buffer.concat( [ data, d ] );
					let index;

					function condition( expectedBytes ) {
						if( expectedBytes && lineCount == 0 ) {
							if( data.length < expectedBytes ) {
								return -1;
							}
							return expectedBytes;
						} else {
 							return data.indexOf( Buffer.from( [0x0d, 0x0a] ) );
						}
					}

					while( ( index = condition( expectedBytes) ) >= 0 ) {

					//	expectedBytes = 0;
						lineCount++; // Found a new line, increment the counter
						if( lineCount == linesExpected ) {

							// Collect the status byte from the remote host
							// If the instance implements the updateStatus method, then call it
							this.statusByte = data.slice( 0, index );
							//console.log( "Status byte ", this.statusByte );
							if ( this.updateStatus ) {
								this.updateStatus();
							}
						} else {

							const d = data.slice( 0, index );

							if( rawOutput ) {
								dOut.push( d );
							} else {
								dOut.push( d.toString( 'ascii' ) ); // Look for carriage return + new line feed
							}
						}

						//console.log( data, data.length );
						
						// Strip the CRLF from the data
						data = data.slice( index + 2 );

						if( lineCount >= linesExpected ) {	// End of the transmission

							if( this.checkStatusbyte && this.statusByte && this.configured && this.statusByte[ 0 ] & 0b00000001 == 0 ) {
									console.error("Instrument is not in a configured state. Attempting to re-configure");
									this.configured = false;
									this.configure(); // Instrument has been reset. We
							}
							// Remove all listeners
							communication.removeAllListeners( "data" );

							// Flush the connection
							communication.flush();
							// Inform about the communication time
							if( timeout ) {
								clearTimeout( timeout );
							}

							console.timeEnd( "query:" + queryString );
							await delay( queryAfterWait );
							if( dOut.length == 1 ) {
								if( expectedBytes ) {
									resolver( dOut[ 0 ].slice( 0, expectedBytes ) );
								} else {
									resolver( dOut[ 0 ] );
								}
							} else {
								resolver( dOut );
							}

							return;
						}
					}
				} );

				console.time( "query:" + queryString );
			//	console.log( queryString );
				communication.write( queryString + "\n" );
			//	communication.drain( );
			} );

		}, prepend );
	}

	emptyQueryQueue() {
		this.getConnection().queryManager.emptyQueue();
		this.getStateManager().emptyQueue();
	}

	/**
	 *	@returns {SerialPort} The serial communication with the instrument
	 */
	 getConnection() {

	 	if( ! this.connection ) {
	 		throw "Cannot retrieve the serial connection. Connection does not exist yet.";
	 	}

	 	return this.connection;
	 }



	/**
	 *	@returns the configuration object
	 */
	 getConfig() {
	 	return this.communicationConfig;
	 }


	 async reset() {

	 	if( this.resetting ) {
	 		return;
	 	}
	 	this.resetting = true;
	 	this.open = false;


	 	if( this.connection && this.connection.isOpen ) {

	 		this.connection.removeAllListeners( 'data' );
	 		console.log("Reset: closing the port");
	 		this.connection.close( () => {
	 			console.log("Reset: port is closed");
	 		});
	 	}

	 	if( this.communicationConfig.resetPin ) {
	 		console.log("Resetting with pin " + this.communicationConfig.resetPin );
	 		rpio.write( this.communicationConfig.resetPin, rpio.HIGH );
	 		rpio.sleep( 1 );
	 		rpio.write( this.communicationConfig.resetPin, rpio.LOW );
	 		rpio.sleep( 1 );
	 	}


		await this.waitAndReconnect();	// Should reattempt directly here, because the rejection occurs only once.
		this.emptyQueryQueue();
		this.connection.lease = Promise.resolve();

		await this.configure();

		this.emptyQueryQueue();
		this.connection.lease = Promise.resolve();
		this.resetting = false;
	}



	async openConnection( callback ) {

		const cfg = this.getConfig();
		this.resetting = false;
		if( this.connection && this.connection.isOpen ) {
			callback();
			return;
		}

		if( this.connection ) {
		//	console.log('alr');
			this.connection.open();
			callback();
			return;
		}

		const connection = new serialport( cfg.host, cfg.params );
		this.connection = connection;

		connection.on("error", ( err ) => {

			console.log( err );
			this.reset();

			this.waitAndReconnect();	// Should reattempt directly here, because the rejection occurs only once.

			wsconnection.send( {

				instrumentId: this.getInstrumentId(),
				log: {
					type: 'error',
					message: `Error while connecting to the serial interface ${ cfg.host }. The controller has lost sight of the acquisition board. You should contact us immediately.`
				}
			} );


			console.warn(`Error thrown by the serial communication: ${ err }`);
		} );

		connection.on("close", ( ) => {

			this.open = false;
			console.warn('Serial connection is closing');
		//	this.waitAndReconnect();

	} );

		return new Promise( ( resolver, rejecter ) => {

			connection.lease = Promise.resolve();
			connection.queryManager = new queryManager( connection );

			const connectionTimeout = setTimeout( () => {

				// TODO: Reset hardware
				//connection.open();
				this.reset();
				this.waitAndReconnect();

			}, 1000 );

			connection.once("open", async () => {
				connection.flush();
				console.log("Serial connection is open");
				clearTimeout( connectionTimeout );
				this.open = true;

				callback();
			} );

		} );
	}

	async waitAndReconnect() {

		try {

			if( this.connection.isOpen() ) {
				this.connection.close();
			}
		} catch( e ) {}

		let _delay = this.getConfig().reconnectTimeout;
		await this.delay( _delay * 1000 );
		console.log('open connection');

		this.connection.once("open", async () => {
			this.connection.flush();
			console.log("Serial connection is open");
			this.open = true;
		} );

		this.connection.open();
		console.log('opened');
		//this.getConnection().queryManager.block();
		await this.delay( _delay * 1000 );
		//this.getConnection().queryManager.unblock();
	}


	getStateManager() {
		return this.getManager('state');
	}

	getManager( name ) {

		if( ! this.managers[ name ] ) {
			this.managers[ name ] = new queryManager();
		}

		return this.managers[ name ];
	}

	delay( delayMS = 100 ) {
		return new Promise( ( resolver ) => { setTimeout( () => { resolver() }, delayMS ) } );
	}

	error( message, chanId ) {

		wsconnection.send( {
			instrumentId: this.getInstrumentId(),
			log: {
				type: 'error',
				channel: chanId,
				message: message
			}
		} );

		throw message;
	}
}

function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}

module.exports = InstrumentController;
