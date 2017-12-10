'use strict';

const express = require("express");

const config = require("./config");

const bodyParser = require('body-parser');
const fs = require('fs');

const HostManager = require('./hostmanager');

const trackerController = require('./trackercontroller/main');
const lightController = require('./lightcontroller/main');
const relayController = require('./relaycontroller/main');
const heatController = require('./heatcontroller/main');


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

	res.send( JSON.stringify( trackerController.getInstruments( ) ) );
} );



app.get("/getChannels", function( req, res ) {

	res.type("application/json");
	res.header("Content-Type", "application/json");

	const instrumentId = req.query.instrumentId;
	const groupName = req.query.groupName;

	res.send( JSON.stringify( trackerController.getChannels( instrumentId, groupName ) ) );
} );


app.get("/getGroups", function( req, res ) {

	res.type("application/json");
	res.header("Content-Type", "application/json");

	const instrumentId = req.query.instrumentId;

	res.send( JSON.stringify( trackerController.getGroups( instrumentId ) ) );
} );

app.post("/setInfluxDB", function( req, res ) {

	let cfg = req.body;
	config.influx = cfg;

	fs.writeFileSync("./config/influx.json", JSON.stringify( config.influx, undefined, "\t" ) );	
	res.send( "" );
} );


app.get("/getStatus", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const chanId = req.query.chanId;
	
	res.send( JSON.stringify( trackerController.getStatus( instrumentId, chanId ) ) );
} );




app.get("/getGroupConfig", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const groupName = req.query.groupName;
	
	res.send( JSON.stringify( trackerController.getGroupConfig( instrumentId, groupName ) ) );
} );


app.get("/getInstrumentConfig", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const groupName = req.query.groupName;
	
	res.send( JSON.stringify( trackerController.getInstrumentConfig( instrumentId ) ) );
} );


app.get("/getChannelConfig", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const chanId = req.query.chanId;
	
	res.send( JSON.stringify( trackerController.getChannelConfig( instrumentId, chanId ) ) );
} );

app.get("/getConfig", function( req, res ) {

	res.type("application/json");

	const instrumentId = req.query.instrumentId;
	const chanId = req.query.chanId;
	
	res.send( JSON.stringify( matahari.getConfig( instrumentId, chanId ) ) );
} );


app.get("/executeIV", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	trackerController.executeIV( instrumentId, chanId ).then( () => {
		
		res.send( "" );	

	} ).catch( ( error ) => {

		console.error( error );
		res.status(500).send("IV could not be executed. Error was " + error );

	} );
} );



app.get("/recordVoc", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	trackerController.measureVoc( instrumentId, chanId ).then( () => {
		
		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status(500).send("Voc measurement failed. Error was " + error );

	} );
} );



app.get("/recordJsc", function( req, res ) {

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;

	trackerController.measureJsc( instrumentId, chanId ).then( () => {
		
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
		results[ channel ] = await trackerController.measureCurrent(  instrumentId, channel );
	}

	res.type( "application/json" );
	res.send( JSON.stringify( results ) );
});

app.get("/setVoltage", async ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId,
		voltage = parseFloat( req.query.voltage );

	trackerController.setVoltage( instrumentId, chanId, voltage ).then( () => {
		
		res.send("");

	} ).catch( ( error ) => {

		console.log( error );
		res.status( 500 ).send("Could not set voltage. Error was " + error );
	} );

});

app.get("/enableChannel", ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId;

	trackerController.enableChannel( instrumentId, chanId ).then( () => {
		res.send("");

	}).catch( ( error ) => {

		console.error( error );
		res.status( 500 ).send("Could not enable the channel. Error was " + error );
	});
});


app.get("/disableChannel", ( req, res ) => {

	let instrumentId = req.query.instrumentId,
		chanId = req.query.chanId;

	trackerController.disableChannel( instrumentId, chanId ).then( () => {

		res.send("");

	}).catch( ( error ) => {

		console.error( error );
		res.status( 500 ).send("Could not disable the channel. Error was " + error );
	});
});

app.get("/pauseChannels", function( req, res ) {

	trackerController.pauseChannels( req.query.instrumentId ).then( () => {

		res.send( "" );	

	} ).catch( ( error ) => {

		console.log( error );
		res.status( 500 ).send("Could not pause the channels. Error was " + error );
	} );	

} );


app.get("/resumeChannels", function( req, res ) {

	res.type("application/json");
	
	trackerController.resumeChannels( req.query.instrumentId ).then( () => {

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

	trackerController.saveStatus( instrumentId, chanId, status ).then( () => {
		
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
			await trackerController.saveStatus( instrumentId, chanId, req.body.chanStatuses[ chanId ] );
		}

		resolver();

	}).then( () => {
		
		res.send("");	
		
	} ).catch(( error ) => {

		console.log( error );

		res
		  .status( 500 )
		  .send( "Channel " + chanId + " could not be updated. Error was " + error );	
	} );
} );

app.get("/resetStatus", function( req, res ) {

	let status = req.query;
	let instrumentId = status.instrumentId,
		chanId = parseInt( status.chanId );

	trackerController.resetStatus( instrumentId, chanId, status ).then( () => {
		
		res.send("");	
		
	}).catch(( error ) => {

		console.log( error );
		res.status( 500 ).send("Channel " + chanId + " could not be reset. Error was " + error );
	 });
});

app.get("/getAllMeasurements", function( req, res ) {

	res.type( "application/json" ).send( JSON.stringify( trackerController.getAllMeasurements( ) ) );
});

app.get("/dropMeasurement", function( req, res ) {

	try {
		trackerController.dropMeasurement( req.query.measurementName );
		res.send("");
	} catch( e ) {
		res.status( 500 ).send( e )
	}
});

app.get("/resetSlave", ( req, res ) => {

	trackerController.resetSlave( req.query.instrumentId ).then( ( ) => {

		res.send("");

	}).catch( ( error ) => {
		res.status( 500 ).send("Cannot reset slave. Error was " + error );
	})

} );

app.get("/light.enable", ( req, res ) => {
	trackerController.lightEnable( req.query.instrumentId, req.query.groupName ).then( () => {
		res.send("");
	}).catch( ( error ) => { res.status( 500 ).send( `Request error: ${error}`) } )
});

app.get("/light.disable", ( req, res ) => {
	trackerController.lightDisable( req.query.instrumentId, req.query.groupName ).then( () => {
		res.send("");
	}).catch( ( error ) => { res.status( 500 ).send( `Request error: ${error}`) } )
});


app.get("/light.isEnabled", ( req, res ) => {
	trackerController.lightIsEnabled( req.query.instrumentId, req.query.groupName ).then( ( value ) => {
		res.send( value );
	}).catch( ( error ) => { res.status( 500 ).send( `Request error: ${error}`) } )
});

app.get("/light.setSetpoint", ( req, res ) => {
	trackerController.lightSetSetpoint( req.query.instrumentId, req.query.groupName, req.query.setPoint ).then( () => {
		res.send("");
	}).catch( ( error ) => { res.status( 500 ).send( `Request error: ${error}`) } )
});

app.get("/light.setScaling", ( req, res ) => {
	trackerController.lightEnable( req.query.instrumentId, req.query.groupName, req.query.scaling ).then( () => {
		res.send("");
	}).catch( ( error ) => { res.status( 500 ).send( `Request error: ${error}`) } )
});

app.get("/lightGetControl", function( req, res ) {
	try {
		let control = trackerController.lightGetControl( req.query.instrumentId, req.query.groupName );
		res.type("application/json").send( JSON.stringify( control ) );	
	} catch( e ) {
		res.status( 500 ).send(`Light control could not be retrieved. Error was ${error}`);
	}
});

app.post("/lightSaveControl", ( req, res ) => {

	trackerController.lightSetControl( req.body.instrumentId, req.body.groupName, req.body.control ).then( () => {	
	
		res.send("");
	
	}).catch( ( error ) => {

		console.error( error );
		res.status( 500 ).send(`Cannot save light control. Error was ${error}`);

	});
});

app.post("/heat.setPower", function( req, res ) {


	trackerController.setHeatingPower( req.body.instrumentId, req.body.groupName, req.body.power ).then( ( ) => {
		
		res.send( "" );	
		
	} ).catch( ( error ) => {

		console.log( error );
		console.trace( error );
		res.status( 500 ).send("Heating power could not be set. Error was \"" + error + "\"" );
	} );
});

app.get("/heat.getPower", function( req, res ) {

	trackerController.getHeatingPower( req.query.instrumentId, req.query.groupName ).then( ( power ) => {
		
		res.send( power );	
		
	} ).catch( ( error ) => {

		console.log( error );
		console.trace( error );
		res.status( 500 ).send("Heating power could not be retrieved. Error was \"" + error + "\"" );
	} );
} );


app.get("/heat.increasePower", function( req, res ) {

	trackerController.increaseHeatingPower( req.query.instrumentId, req.query.groupName ).then( ( power ) => {
		console.log( power );
		res.type("application/json").send( JSON.stringify( { heatingPower: power } ) );	
		
	} ).catch( ( error ) => {

		console.log( error );
		console.trace( error );
		res.status( 500 ).send("Heating power could not be retrieved. Error was \"" + error + "\"" );
	} );
} );


app.get("/heat.decreasePower", function( req, res ) {

	trackerController.decreaseHeatingPower( req.query.instrumentId, req.query.groupName ).then( ( power ) => {
		console.log( power );
		res.type("application/json").send( JSON.stringify( { heatingPower: power } ) );	
		
	} ).catch( ( error ) => {

		console.log( error );
		console.trace( error );
		res.status( 500 ).send("Heating power could not be retrieved. Error was \"" + error + "\"" );
	} );
} );
