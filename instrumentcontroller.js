
const serialport 	= require("serialport");
const queryManager	= require("./queryhandler")
const rpio 			= require("rpio");
const wsconnection	= require('./wsconnection' );

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
		return this.instrumentConfig;
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

		let queryString;
		let queryTimeout;

		if( typeof query == "object" ) {
			queryString = query.string;
			queryTimeout = query.timeout;
		} else {
			queryString = query;
			queryTimeout = 1000;
		}

		queryTimeout = queryTimeout || 1000; // Default to 1 second

		let statusByte;

		if( ! communication ) {
			throw "Could not find communication based on the instrument id";
		}	


		return communication.queryManager.addQuery( async () => {

			await communication.lease;

			if( executeBefore ) {
				if( ! executeBefore() ) {
					throw "Cannot execute method. Forbidden";
				}
			}

			let statusByte;

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

				//	rejecter(); // Reject the current promise
					//this.reset(); // Reset the instrument
				}, queryTimeout );
			
				// Start by remove all listeners
				communication.removeAllListeners( "data" );

				// Listening
				communication.on( "data", async ( d ) => {


					if( queryString.indexOf("IV:DATA")>-1 ) {
						console.log( d.toString('ascii') );
					}
					data = Buffer.concat( [ data, d ] );

					let index;

					function condition( expectedBytes ) {

						if( expectedBytes ) {

							if( data.length < expectedBytes ) {
								return -1;
							}

							return expectedBytes;

						} else {

							return data.indexOf( 0x0d0a ) - 1;
						}
					}

					while( ( index = condition( expectedBytes ) ) >= 0 ) { // CRLF detection
						
						
						expectedBytes = 0;
						lineCount++; // Found a new line, increment the counter

						if( lineCount == linesExpected ) {

							statusByte = data.slice( 0, index )[ 0 ];
							
						} else {

							const d = data.slice( 0, index );
							
							if( rawOutput ) {
								dOut.push( d );
							} else {
								dOut.push( d.toString( 'ascii' ) ); // Look for carriage return + new line feed
							}
						}

						data = data.slice( index + 2 );

						if( lineCount >= linesExpected ) {	// End of the transmission

							if( statusByte !== undefined ) {
								if( this.checkStatusbyte && ( statusByte & 0x01 ) == 0x00 && this.configured ) {  // LSB is the reset bit
									console.error("Instrument is not in a configured state. Attempting to re-configure");
									this.configured = false;
									this.configure(); // Instrument has been reset. We
								}
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
							await delay( 10 );
							

							if( dOut.length == 1 ) {
								resolver( dOut[ 0 ] );
							} else {
								resolver( dOut );
							}
							
							return;
						}
					}
				} );

				console.time( "query:" + queryString );
				//console.log( queryString );
				communication.write( queryString + "\n" );
				communication.drain( );
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
			console.log('alr');
			this.connection.open();
			callback();
			return;
		}

		const connection = new serialport( cfg.host, cfg.params );
		this.connection = connection;
		
		connection.on("error", ( err ) => {
			console.log( "Error:" + err );
			this.reset();
			this.waitAndReconnect();	// Should reattempt directly here, because the rejection occurs only once.
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

		let _delay = this.getConfig().reconnectTimeout;
		await this.delay( _delay * 1000 );
		this.connection.open();
		this.getConnection().queryManager.block();
		await this.delay( _delay * 1000 );
		this.getConnection().queryManager.unblock();
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
}

function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}

module.exports = InstrumentController;