
var SerialPort = require("serialport");

var serialPort = new SerialPort( '/dev/serial/by-path/platform-3f980000.usb-usb-0:1.2:1.0', { baudrate: 57600 } );


let delay = ( delay ) => {
	return new Promise( ( resolver ) => {
		setTimeout( resolver, delay );	
	});
}

serialPort.on('open', async () => {

	await delay( 100 );
	serialPort.write( "RESERVED:SETUP\n");
	await delay( 100 );
	
await delay( 1000 );

//serialPort.write( "IV:EXECUTE:CH6\n");

	

	for( var i = 0; i < 100; i ++ ) {
		await delay( 100 );
		serialPort.write( "ENVIRONMENT:PHOTODIODE2\n");
	}
	
});

let data = "";
serialPort.on("data", ( d ) => {
	data += d.toString('ascii');
	while( data.indexOf("\n") > 0 ) {

		let d = data.substr( 0, data.indexOf("\n") );
		data = data.substr( data.indexOf("\n") + 1 );

		if( d !== "ok\r" ) {
			d = parseFloat( d );
			console.log( d * 1000 );
		}
	}
})
