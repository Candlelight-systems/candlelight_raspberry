'use strict';

const pm2 = require('pm2');
const express = require('express');
const config = require('./config');
const bodyParser = require('body-parser');
var app = express();

app.use(bodyParser.json()); // to support JSON-encoded bodies
app.use(
  bodyParser.urlencoded({
    // to support URL-encoded bodies
    extended: true
  })
);

app.get('/ping', function(req, res) {
  res.type('text/plain');
  res.send('Ok');
});

app.get('/processList', function(req, res) {
  console.log(
    pm2.list((error, processes) => {
      res.header('Content-Type', 'application/json');
      res.send(JSON.stringify(processes));
    })
  );
});

var server = app.listen(config.express_processmanagement.port, function() {
  /* callback */
});

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  next();
});
