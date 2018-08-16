
const CRC_Table = new Array( 256 );

module.exports = {

	calculateCRC: ( data, numBytes ) => {

		var crc = 0x00;
		for( var i = 0; i < numBytes; i ++ ) {
			
			crc = CRC_Table[ ( data[ i ] ^ crc ) ];
			//console.log( data[ 0 ][ i ].toString(16));
			crc &= 0xFF;
		}

		if( ! crc ) {
			return;
		}

		return crc;
	}
}

function calculateCRCTable() {

	var generator = 0x1D;
	for( i = 0; i < 256; i ++ ) {
		var byte = i;
		for( let bit = 0; bit < 8; bit ++ ) {
			if( ( byte & 0x80 ) != 0 ) {
				byte <<= 1;
				byte ^= generator;
			} else {
				byte <<= 1;
			}

			byte &= 0xFF;
		}

		CRC_Table[ i ] = byte & 0xFF;
	}
}

calculateCRCTable();