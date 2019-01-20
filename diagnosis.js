'use strict';

const pm2 = require('pm2');
const express = require('express');
const config = require('./config');
const bodyParser = require('body-parser');
const { execFile } = require('child_process');
const hosts = require('./config/hosts.json');
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

app.get('/processStatus', function(req, res) {
  pm2.list((error, processes) => {
    processes = processes.filter(process => process.name == 'main');
    res.header('Content-Type', 'application/json');
    res.send(JSON.stringify(processes[0]));
  });
});

app.get('/processRestart', function(req, res, next) {
  pm2.connect(function(err) {
    if (err) {
      next(err);
    }

    pm2.restart('main', () => {
      res.send('Ok');
      pm2.disconnect();
    });
  });
});

app.get('/processStart', function(req, res, next) {
  pm2.connect(function(err) {
    if (err) {
      next(err);
    }

    pm2.restart({ script: 'main.js' }, err => {
      res.send(err);
      pm2.disconnect();
    });
  });
});

app.get('/listBoards', function(req, res) {
  const path = '/dev/serial/by-path/';
  execFile('ls', [path], (error, stdout, stderr) => {
    const boards = stdout.split('\n');
    const h = hosts.map(b => {
      for (var i = 0; i < boards.length; i++) {
        if (b.host == path + boards[i]) {
          return {
            host: b.host,
            alias: b.alias,
            responsive: true
          };
        }
      }

      return {
        host: b.host,
        alias: b.alias,
        responsive: false
      };
    });

    res.header('Content-Type', 'application/json');
    res.send(JSON.stringify(h));
  });
});

app.get('/downloadLog', function(req, res) {
  pm2.list((error, processes) => {
    processes = processes.filter(process => process.name == 'main');
    //res.send(processes[0].pm2_env.pm_out_log_path);
    console.log(processes[0].pm2_env.pm_error_log_path);
    res.sendFile(processes[0].pm2_env.pm_out_log_path);
  });
});

app.get('/downloadErrorLog', function(req, res) {
  pm2.list((error, processes) => {
    processes = processes.filter(process => process.name == 'main');
    //res.send(processes[0].pm2_env.pm_error_log_path);

    res.sendFile(processes[0].pm2_env.pm_err_log_path);
  });
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
