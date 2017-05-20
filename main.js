'use strict';

const express = require("express");
const config = require("./config")
const matahari = require("./matahari/main");
const bodyParser = require('body-parser')

var app = express();
var server = app.listen( config.express.port, function() {
	console.log('app started');
} );


app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use( bodyParser.urlencoded( {     // to support URL-encoded bodies
  extended: true
} ) ); 
//app.use(express.json());  

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get("/getChannels", function( req, res ) {

	res.type("application/json");
	res.send( JSON.stringify( matahari.getChannels() ) );
} );

app.post("/setInfluxDB", function( req, res ) {

	let cfg = req.body;
	config.influx = cfg;
	fs.writeFileSync("influx.json", JSON.stringify( config.influx, undefined, "\t" ) );	
	res.send( "" );
} );


app.get("/getStatus", function( req, res ) {

	res.type("application/json");

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;
	
	res.send( JSON.stringify( matahari.getStatus( instrumentId, chanId ) ) );
} );




app.get("/executeIV", function( req, res ) {

	res.type("application/json");

	var chanId = req.query.chanId;
	var instrumentId = req.query.instrumentId;
console.log( chanId, instrumentId, req.query );	
	matahari.executeIV( instrumentId, chanId ).then( () => {
		res.send( "Ok" );	
	}).catch( ( error ) => {
		console.error("IV not executed");
		console.log( error );
		res.send("Not ok");
	});
	
} );

app.post("/setStatus", function( req, res ) {

	let status = req.body;
	let instrumentId = status.instrumentId,
		chanId = status.chanId;

	matahari.saveStatus( instrumentId, chanId, status ).then( () => {
		
		res.send("Ok");	
		console.log("Channel updated");

	}).catch(( error ) => {

		console.error("Channel not updated");
		console.log( error );
		res.send("Not ok");
	 });
});

