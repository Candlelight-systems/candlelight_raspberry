'use strict';

const express = require("express");
const config = require("./config");
const bodyParser = require('body-parser');
var app = express();

app.use( bodyParser.json() );       // to support JSON-encoded bodies
app.use( bodyParser.urlencoded( {     // to support URL-encoded bodies
  extended: true
} ) ); 


const routes = require('./routes')(app);

var server = app.listen( config.express.port, function() { /* callback */ } );



app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});
