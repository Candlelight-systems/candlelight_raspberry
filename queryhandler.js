
class queryManager {

	constructor( ) {
		this.queue = [];
		this.processing = false;
	}

	addQuery( q, prepend ) {
		
		let done = new Promise( ( resolver, rejecter ) => {

			let o = { 
				query: q,
				resolver: resolver,
				rejecter: rejecter
			};

			if( prepend ) {
				this.queue.unshift( o );
			} else {
				this.queue.push( o );	
			}
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

	emptyQueue() {

		this.queue = [];
		this.processing = false;
	}

	doQuery( query ) {

		query.query().then( ( results ) => {
			
			this.processing = false;
			this.processQueue();

			query.resolver( results );
		} ).catch( ( error ) => {
			query.rejecter( error );

			this.processing = false;
			this.processQueue();

		} );
	}
}

module.exports = queryManager;