
const serialport 	= require("serialport");
const queryManager	= require("./queryhandler")
const rpio 			= require("rpio");

function query( communication, query, linesExpected = 1, executeBefore = () => { return true; }, prepend ) {

	if( query === undefined ) {
		console.trace();
		return;
	}
	
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

		return communication.lease = new Promise( ( resolver, rejecter ) => {

			let data = "", 
				dataThatMatters, 
				lineCount = 0;

		//	console.time("q");
			communication.removeAllListeners( "data" );
			communication.on( "data", async ( d ) => {

				data += d.toString('ascii'); // SAMD sends ASCII data

				while( data.indexOf("\r\n") > -1 ) {
					
					lineCount++;
					
					if( lineCount == 1 ) {

						dataThatMatters = data.substr( 0, data.indexOf("\r\n") );
						data = data.substr( data.indexOf("\r\n") + 2 );
					}

					if( lineCount >= linesExpected ) {

						communication.removeAllListeners( "data" );
						communication.flush();
						await delay( 10 );
						console.log("end");
						resolver( dataThatMatters );
						return;
					}
				}
			} );	
			console.log( "query:" + query );

			communication.write( query + "\n" );
			communication.drain( );
		});
	}, prepend );
}



class InstrumentController {
	
	
	constructor( config ) {

		this.communicationConfig = config;
		this.stateManager = new queryManager();

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

	query( queryString, expectedLines = 1, prepend ) {
		return query( this.getConnection(), queryString, expectedLines, () => { return true; }, prepend )
	}

	emptyQueryQueue() {
		this.getConnection().queryManager.emptyQueue();
		this.stateManager.emptyQueue();
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


	async openConnection( callback ) {

		const cfg = this.getConfig();

		if( this.connection ) {
			this.connection.open();
			return;
		}

		const connection = new serialport( cfg.host, cfg.params );
		this.connection = connection;

		connection.on("error", ( err ) => {

			if( this.communicationConfig.resetPin ) {
				console.log("Resetting with pin " + this.communicationConfig.resetPin );
				rpio.write( this.communicationConfig.resetPin, rpio.HIGH );
				rpio.sleep( 2 );
				rpio.write( this.communicationConfig.resetPin, rpio.LOW );
				rpio.sleep( 1 );
			}

			this.waitAndReconnect();	// Should reattempt directly here, because the rejection occurs only once.
			console.warn(`Error thrown by the serial communication: ${ err }`); 
		} );

		connection.on("close", ( ) => {

			this.open = false;
			console.warn('The serial connection is closing');
			this.waitAndReconnect();
			
		} );

		return new Promise( ( resolver, rejecter ) => {

			connection.lease = Promise.resolve();
			connection.queryManager = new queryManager( connection );

			const connectionTimeout = setTimeout( () => {

				// TODO: Reset hardware
				//connection.open();

			}, 1000 );

			connection.on("open", async () => {
				connection.flush();
				clearTimeout( connectionTimeout );
				this.open = true;

				callback();
			} );

		} );
	}

	async waitAndReconnect() {

		let _delay = this.getConfig().reconnectTimeout;
		await this.delay( _delay * 1000 );
		return this.connection.open();
	}

	
	getStateManager() {
		return this.stateManager;
	}


	delay( delayMS = 100 ) {
		return new Promise( ( resolver ) => { setTimeout( () => { resolver() }, delayMS ) } );
	}
}

function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}

module.exports = InstrumentController;