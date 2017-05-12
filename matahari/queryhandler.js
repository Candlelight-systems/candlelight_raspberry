
class queryManager {

	constructor( ) {
		this.queue = [];
		this.processing = false;
	}

	addQuery( q ) {
		
		let done = new Promise( ( resolver, rejecter ) => {
			this.queue.push( { 
				query: q,
				resolver: resolver,
				rejecter: rejecter
			} );
		} );
		this.processQueue();
		return done;
	}

	processQueue() {


		if( this.processing ) { 
			return;
		}
		this.processing = true;

		if( this.queue.length == 0 ) {
			this.processing = false;
			return;
		}

		this.doQuery( this.queue.shift() );
	}

	doQuery( query ) {

		query.query().then( ( results ) => {
			
			this.processing = false;
			this.processQueue();

			query.resolver( results );
		} ).catch( ( error ) => {
			query.rejecter( error );
		} );
	}
}

module.exports = queryManager;