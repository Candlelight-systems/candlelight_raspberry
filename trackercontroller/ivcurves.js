makeIV( chanId ) {

	var status = this.getStatus( chanId );
	this.preventMPPT[ chanId ] = true;

	if( ! status.enable ) {
		throw "Channel not enabled";
	}

	await this.getManager('IV').addQuery( async () => {
			return this.query( "IV:EXECUTE:CH1" );
	} );

	while( true ) {

		let status = parseInt( await this.query("IV:STATUS:CH1") );

		if( status & 0b00000001 ) { // If this particular jv curve is still running
			await this.delay( 1000 );
			continue;
		}

		break; // That one IV curve has stopped

		// Now we must ask the IV manager to fetch them all and pause any new start
	}

	// This will delay any further jV curve beginning until they are all done
	let data = await this.getManager('IV').addQuery( async () => {
			
		while( true ) {

			let status = parseInt( await this.query("IV:STATUS:CH1") );

			if( status & 0b00000010 ) { // When ALL jV curves are done
				await this.delay( 1000 );
				continue;
			}
			return this.query( "IV:DATA:CH1" );
		}

	} );


	<<<<<<< HEAD
	let ivcurveData = await this.requestIVCurve( chanId );
	influx.storeIV( status.measurementName, ivcurveData, this.getLightFromChannel( chanId ) );
	=======
	//	let light = await this.getChannelLightIntensity( chanId );
	await this.requestIVCurve( chanId );
	while( await this.requestIVCurvePolling( ) ) {
		await delay( 1000 ); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
	}

	let ivcurveData = await this.requestIVCurveData();

	ivcurveData.shift();

	const light = 1;
	>>>>>>> 45561ea688eece599cb4754e922fb7c6e780c1c2

	influx.storeIV( status.measurementName, ivcurveData, light );

	wsconnection.send( {

		instrumentId: this.getInstrumentId(),
		chanId: chanId,

		action: {
			ivCurve: true
		}
	} );

	this.preventMPPT[ chanId ] = false;
	this._setStatus( chanId, 'iv_booked', false, undefined, true );

	const wave = new waveform();

	for( let i = 0; i < ivcurveData.length; i += 2 ) {
		wave.append( ivcurveData[ i ], ivcurveData[ i + 1 ] );	
	}

}