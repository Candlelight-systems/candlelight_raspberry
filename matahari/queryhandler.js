
class queryManager {

	constructor( stream ) {
		this.queue = [];
		this.processing = false;
		this.stream = stream;
	}

	addQuery( q ) {
		console.log('add');
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
console.log('q');
		this.doQuery( this.queue.shift() );
	}

	doQuery( query ) {
		if( ! this.stream ) {
			throw "Stream does not exist";
		}

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