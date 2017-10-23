
var SerialPort = require("serialport");

var serialPort = new SerialPort( '/dev/serial/by-path/platform-3f980000.usb-usb-0:1.2:1.0', { baudrate: 57600 } );


let delay = ( delay ) => {
	return new Promise( ( resolver ) => {
		setTimeout( resolver, delay );	
	});
}

serialPort.on('open', async () => {
console.log('open');
	serialPort.write( "OUTPUT:ENABLE:CH5 1\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH4 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH3 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH2 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH1 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH6 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH7 1\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH8 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH9 1\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH10 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH11 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH12 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH13 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH14 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH15 0\n");
	await delay( 100 );
	serialPort.write( "OUTPUT:ENABLE:CH16 0\n");
	await delay( 100 );
	serialPort.write( "TRACKING:GAIN:CH9 128\n");
	await delay( 100 );
	serialPort.write( "RESERVED:SETUP\n");
	await delay( 100 );
	
await delay( 1000 );

//serialPort.write( "IV:EXECUTE:CH6\n");

	serialPort.write( "RESERVED:DACVOLTAGE:CH9 2047\n");

	for( var i = 0; i < 100; i ++ ) {
		await delay( 100 );
		serialPort.write( "RESERVED:ADCCURRENT:CH9\n");
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
