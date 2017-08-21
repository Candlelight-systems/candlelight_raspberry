'use strict';

const express = require("express");
const config = require("./config");
const bodyParser = require('body-parser');
const fs = require('fs');
const matahari = require('./matahari/main');

var app = express();
var server = app.listen( config.express.port, function() { /* callback */ } );


app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use( bodyParser.urlencoded( {     // to support URL-encoded bodies
  extended: true
} ) ); 


app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get("/idn", function( req, res ) {

	res.type("text/plain");
	res.send( config.instrument.id );
} );


app.get("/getInstruments", function( req, res ) {

	res.type("application/json");
	res.header("Content-Type", "application/json");

	res.send( JSON.stringify( matahari.getInstruments( ) ) );
} );



app.get("/getChannels", function( req, res ) {

	res.type("application/json");
	res.header("Content-Type", "application/json");

	const instrumentId = req.query.instrumentId;

	res.send( JSON.stringify( matahari.getChannels( instrumentId ) ) );
} );

app.post("/setInfluxDB", function( req, res ) {

	let cfg = req.body;
	config.influx = cfg;

	fs.writeFileSync("influx.json", JSON.stringify( config.influx, undefined, "\t" ) );	
	res.send( "" );
} );


app.get("/getStatus", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const chanId = req.query.chanId;
	
	res.send( JSON.stringify( matahari.getStatus( instrumentId, chanId ) ) );
} );


app.get("/getPDOptions", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	
	res.send( JSON.stringify( matahari.getPDOptions( instrumentId ) ) );
} );





app.get("/executeIV", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	matahari.executeIV( instrumentId, chanId ).then( () => {
		
		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status(500).send("IV could not be executed. Error was " + error );

	} );
} );



app.get("/recordVoc", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	matahari.measureVoc( instrumentId, chanId ).then( () => {
		
		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status(500).send("Voc measurement failed. Error was " + error );

	} );
} );



app.get("/recordJsc", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	matahari.measureJsc( instrumentId, chanId ).then( () => {
		
		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status(500).send("Jsc measurement failed. Error was " + error );

	} );
} );
	
app.get("/measureCurrent", async ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		channels = req.query.chanIds.split(','),
		results = {};

	for( let channel of channels ) {
		results[ channel ] = await matahari.measureCurrent( channel );
	}

	res.type( "application/json" );
	res.send( JSON.stringify( results ) );
});

app.get("/setVoltage", async ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId,
		voltage = parseFloat( req.query.voltage );

	matahari.setVoltage( instrumentId, chanId, voltage ).then( () => {
		
		res.send("");

	} ).catch( ( error ) => {

		console.log( error );
		res.status( 500 ).send("Could not set voltage. Error was " + error );
	} );

	res.type( "application/json" );
	res.send( JSON.stringify( results ) );
});

app.get("/enableChannel", ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId;

	matahari.enableChannel( instrumentId, chanId ).then( () => {
		res.send("");

	}).catch( ( error ) => {

		console.error( error );
		res.status( 500 ).send("Could not enable the channel. Error was " + error );
	});
});


app.get("/disableChannel", ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId;

	matahari.disableChannel( instrumentId, chanId ).then( () => {

		res.send("");

	}).catch( ( error ) => {

		console.error( error );
		res.status( 500 ).send("Could not disable the channel. Error was " + error );
	});
});

app.get("/pauseChannels", function( req, res ) {

	matahari.pauseChannels( req.query.instrumentId ).then( () => {

		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status( 500 ).send("Could not pause the channels. Error was " + error );
	} );	

} );


app.get("/resumeChannels", function( req, res ) {

	res.type("application/json");
	
	matahari.resumeChannels( req.query.instrumentId ).then( () => {

		res.send( "" );

	} ).catch( ( error ) => {

		console.log( error );
		res.status( 500 ).send("Could not resume channel operation. Error was " + error );

	} );	
} );


app.post("/setStatus", function( req, res ) {

	let status = req.body;
	let instrumentId = status.instrumentId,
		chanId = status.chanId;

	matahari.saveStatus( instrumentId, chanId, status ).then( () => {
		
		res.send("");	
		
	}).catch(( error ) => {

		console.log( error );
		res.status( 500 ).send("Channel " + chanId + " could not be updated. Error was " + error );
	 });
});



app.post("/setStatuses", ( req, res ) => {

	let status = req.body;
	let instrumentId = req.body.instrumentId,
		chanIds = req.body.chanIds;


	new Promise( async ( resolver, rejecter ) => {

		for( let chanId of chanIds ) {
			await matahari.saveStatus( instrumentId, chanId, req.body.chanStatuses[ chanId ] );
		}

		resolver();

	}).then( () => {
		
		res.send("");	
		
	} ).catch(( error ) => {

		console.log( error );

		res
		  .status( 500 )
		  .send( "Channel " + chanId + " could not be updated. Error was " + error );	
	});
} );



app.get("/resetStatus", function( req, res ) {

	let status = req.query;
	let instrumentId = status.instrumentId,
		chanId = status.chanId;

	matahari.resetStatus( instrumentId, chanId, status ).then( () => {
		
		res.send("");	
		
	}).catch(( error ) => {

		console.log( error );
		res.status( 500 ).send("Channel " + chanId + " could not be reset. Error was " + error );
	 });
});

