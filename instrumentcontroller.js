
const serialport 	= require("serialport");
const queryManager	= require("./matahari/queryhandler")


function query( communication, query, linesExpected = 1, executeBefore = () => { return true; } ) {


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
						resolver( dataThatMatters );
						return;
					}
				}
			} );	
			console.log( "query:" + query );
			communication.write( query + "\n" );
			communication.drain( );
		});
	});
}



class InstrumentController {
	
	
	constructor( config ) {
		this.config = config;
		this.stateManager = new queryManager();
	}	

	query( queryString, expectedLines ) {
		return query( this.getConnection(), queryString, expectedLines )
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
		return this.config;
	}


	async openConnection() {

		const cfg = this.getConfig();

		if( this.connection ) {
			this.connection.open();
			return;
		}

		const connection = new serialport( cfg.config.host, cfg.config.params );
		this.connection = connection;


		connection.on("error", ( err ) => {
			this.waitAndReconnect();	// Should reattempt directly here, because the rejection occurs only once.
			console.warn(`Error thrown by the serial communication: ${ err }`); 
		} );

		connection.on("close", ( ) => {

			this.open = false;
			this.waitAndReconnect();
			console.warn('The serial connection is closing');
		} );

		return new Promise( ( resolver, rejecter ) => {

			connection.lease = Promise.resolve();
			connection.queryManager = new queryManager( connection );

			connection.on("open", async () => {
				console.log('Opening the connection');
				connection.flush();
				this.open = true;
				resolver();
			} );

		} );
	}

	async waitAndReconnect() {

		let _delay = this.getConfig().config.reconnectTimeout;
		console.warn("Reconnecting in " + _delay + "s" );
		await this.delay( _delay * 1000 );
		return this.connection.open();
	}

	
	getStateManager() {
		return this.stateManager;
	}


	delay( delayMS = 100 ) {
		return new Promise( ( resolver ) => { setTimeout( resolver, delayMS ) } );
	}
}


function delay( time ) {
	return new Promise( ( resolver ) => setTimeout( () => { resolver(); }, time ) );
}

module.exports = InstrumentController;