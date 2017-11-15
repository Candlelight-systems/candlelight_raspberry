
const WebSocket = require('ws');

const wss = new WebSocket.Server( { port: 8081 } );

wss.on('connection', function connection( ws ) {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true );
});

const interval = setInterval(function ping() {
  wss.clients.forEach( ( ws ) => {

    if (ws.isAlive === false) {
     return ws.terminate();
 	}

    ws.isAlive = false;
    ws.ping( '', false, true );

  } );
}, 30000 );

module.exports = {

	send: ( data ) => {

		wss.clients.forEach( ( ws ) => {
			ws.send( JSON.stringify( data, undefined, "\t" ) );
		} );

	}
}