
class queryManager() {

	constructor( stream ) {
		this.queue = [];
		this.processing = false;
		this.stream = stream;
	}

	addQuery( q ) {
		this.queue.push( q );
		this.processQueue();
	}

	processQueue() {
		if( this.processing ) { 
			return;
		}
		this.processing = true;
		this.doQuery( queue.shift() );
	}

	doQuery( query ) {
		if( ! this.stream ) {
			throw "Stream does not exist";
		}

		query().then( ( results ) => {
			this.processing = false;
			processQueue();
			return results;
		} );
	}
}

module.exports = queryManager;