
const WebSocket = require('ws');

const wss = new WebSocket.Server( { port: 8081 } );

module.exports = {

	send: ( data ) => {

		wss.clients.forEach( ( ws ) => {
			ws.send( JSON.stringify( data, undefined, "\t" ) );
		} );

	}
}