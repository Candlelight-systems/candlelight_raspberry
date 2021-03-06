const fs = require('fs');
const HostManager = require('./hostmanager');
const trackerController = require('./trackercontroller/main');
const influx = require('./trackercontroller/influxhandler');
const config = require('./config');
const pm2 = require('pm2');

module.exports = app => {
  app.get('/idn', function(req, res) {
    res.type('text/plain');
    res.send(config.instrument.id);
  });

  app.get('/getInstruments', function(req, res) {
    res.type('application/json');
    res.header('Content-Type', 'application/json');

    res.send(JSON.stringify(trackerController.getInstruments()));
  });
/*
  app.get('/getChannels', function(req, res) {
    res.type('application/json');
    res.header('Content-Type', 'application/json');

    const instrumentId = req.query.instrumentId;
    const groupName = req.query.groupName;

    res.type('application/json');
    res.header('Content-Type', 'application/json');

    res.send(JSON.stringify(trackerController.getInstruments()));
  });
*/
  app.get('/getChannels', function(req, res) {
    res.type('application/json');
    res.header('Content-Type', 'application/json');

    const instrumentId = req.query.instrumentId;
    const groupName = req.query.groupName;

    res.send(
      JSON.stringify(trackerController.getChannels(instrumentId, groupName))
    );
  });

  app.get('/getGroups', function(req, res) {
    res.type('application/json');
    res.header('Content-Type', 'application/json');

    const instrumentId = req.query.instrumentId;

    res.send(JSON.stringify(trackerController.getGroups(instrumentId)));
  });

  app.post('/setInfluxDB', function(req, res) {
    let cfg = req.body;
    config.influx = Object.assign(config.influx, cfg);

    influx.changed(); // Notify the influx handler that the data has changed
    fs.writeFileSync(
      './config/influx.json',
      JSON.stringify(config.influx, undefined, '\t')
    );
    res.send('');
  });

  app.get('/getStatus', function(req, res) {
    res.type('application/json');

    const instrumentId = req.query.instrumentId;
    const chanId = req.query.chanId;

    res.send(JSON.stringify(trackerController.getStatus(instrumentId, chanId)));
  });

  app.get('/getGroupConfig', function(req, res) {
    res.type('application/json');

    const instrumentId = req.query.instrumentId;
    const groupName = req.query.groupName;

    res.send(
      JSON.stringify(trackerController.getGroupConfig(instrumentId, groupName))
    );
  });

  app.get('/getInstrumentConfig', function(req, res) {
    res.type('application/json');

    const instrumentId = req.query.instrumentId;
    const groupName = req.query.groupName;

    res.send(
      JSON.stringify(trackerController.getInstrumentConfig(instrumentId))
    );
  });

  app.get('/getChannelConfig', function(req, res) {
    res.type('application/json');

    const instrumentId = req.query.instrumentId;
    const chanId = req.query.chanId;

    res.send(
      JSON.stringify(trackerController.getChannelConfig(instrumentId, chanId))
    );
  });

  app.get('/getConfig', function(req, res) {
    res.type('application/json');

    const instrumentId = req.query.instrumentId;
    const chanId = req.query.chanId;

    res.send(JSON.stringify(matahari.getConfig(instrumentId, chanId)));
  });

  app.get('/executeIV', function(req, res) {
    var chanId = req.query.chanId;
    var instrumentId = req.query.instrumentId;

    trackerController
      .executeIV(instrumentId, chanId)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.error(error);
        res.status(500).send('IV could not be executed. Error was ' + error);
      });
  });

  app.get('/recordVoc', function(req, res) {
    var chanId = req.query.chanId;
    var instrumentId = req.query.instrumentId;

    trackerController
      .measureVoc(instrumentId, chanId)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res.status(500).send('Voc measurement failed. Error was ' + error);
      });
  });

  app.get('/recordJsc', function(req, res) {
    var chanId = req.query.chanId;
    var instrumentId = req.query.instrumentId;

    trackerController
      .measureJsc(instrumentId, chanId)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res.status(500).send('Jsc measurement failed. Error was ' + error);
      });
  });

  app.get('/measureCurrent', async (req, res) => {
    let instrumentId = req.query.instrumentId,
      channels = req.query.chanIds.split(','),
      results = {};

    for (let channel of channels) {
      if (channel) {
        results[channel] = await trackerController.measureCurrent(
          instrumentId,
          channel
        );
      }

      results.pd = await trackerController.measurePDCurrent(
        instrumentId,
        req.query.groupName
      );
    }

    res.type('application/json');
    res.send(JSON.stringify(results));
  });

  app.get('/setVoltage', async (req, res) => {
    let instrumentId = req.query.instrumentId,
      chanId = req.query.chanId,
      voltage = parseFloat(req.query.voltage);

    trackerController
      .setVoltage(instrumentId, chanId, voltage)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res.status(500).send('Could not set voltage. Error was ' + error);
      });
  });

  app.get('/enableChannel', (req, res) => {
    let instrumentId = req.query.instrumentId,
      chanId = req.query.chanId,
      noIV = req.query.noIV;

    trackerController
      .enableChannel(instrumentId, chanId, noIV)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.error(error);
        res
          .status(500)
          .send('Could not enable the channel. Error was ' + error);
      });
  });

  app.get('/disableChannel', (req, res) => {
    let instrumentId = req.query.instrumentId,
      chanId = req.query.chanId;

    trackerController
      .disableChannel(instrumentId, chanId)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.error(error);
        res
          .status(500)
          .send('Could not disable the channel. Error was ' + error);
      });
  });

  app.get('/pauseChannels', function(req, res) {
    trackerController
      .pauseChannels(req.query.instrumentId, true)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send('Could not pause the channels. Error was ' + error);
      });
  });

  app.get('/resumeChannels', function(req, res) {
    res.type('application/json');

    trackerController
      .resumeChannels(req.query.instrumentId, true)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send('Could not resume channel operation. Error was ' + error);
      });
  });

  app.post('/setStatus', function(req, res) {
    let status = req.body;
    let instrumentId = status.instrumentId,
      chanId = status.chanId;

    trackerController
      .saveStatus(instrumentId, chanId, status)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send(
            'Channel ' + chanId + ' could not be updated. Error was ' + error
          );
      });
  });

  app.post('/setStatuses', (req, res) => {
    let status = req.body;
    let instrumentId = req.body.instrumentId,
      chanIds = req.body.chanIds;

    new Promise(async (resolver, rejecter) => {
      for (let chanId of chanIds) {
        await trackerController.saveStatus(
          instrumentId,
          chanId,
          req.body.chanStatuses[chanId]
        );
      }

      resolver();
    })
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);

        res
          .status(500)
          .send(
            'Channel ' + chanId + ' could not be updated. Error was ' + error
          );
      });
  });

  app.get('/resetStatus', function(req, res) {
    let status = req.query;
    let instrumentId = status.instrumentId,
      chanId = parseInt(status.chanId);

    trackerController
      .resetStatus(instrumentId, chanId, status)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send(
            'Channel ' + chanId + ' could not be reset. Error was ' + error
          );
      });
  });

  app.get('/getAllMeasurements', function(req, res) {
    res
      .type('application/json')
      .send(JSON.stringify(trackerController.getAllMeasurements()));
  });

  app.get('/getMeasurement', function(req, res) {
    res
      .type('application/json')
      .send(
        JSON.stringify(
          trackerController.getMeasurement(req.query.measurementName)
        )
      );
  });

  app.get('/dropMeasurement', function(req, res) {
    try {
      trackerController.dropMeasurement(req.query.measurementName);
      res.send('');
    } catch (e) {
      res.status(500).send(e);
    }
  });

  app.get('/resetSlave', (req, res) => {
    trackerController
      .resetSlave(req.query.instrumentId)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send('Cannot reset slave. Error was ' + error);
      });
  });

  app.get('/restart', (req, res) => {
    pm2.restart('main');
  });

  app.get('/light.enable', (req, res) => {
    trackerController
      .lightEnable(req.query.instrumentId, req.query.groupName)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/light.disable', (req, res) => {
    trackerController
      .lightDisable(req.query.instrumentId, req.query.groupName)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/light.isEnabled', (req, res) => {
    trackerController
      .lightIsEnabled(req.query.instrumentId, req.query.groupName)
      .then(value => {
        res.send(value);
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/light.setSetpoint', (req, res) => {
    trackerController
      .lightSetSetpoint(
        req.query.instrumentId,
        req.query.groupName,
        req.query.setPoint
      )
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/light.getPyranometerScaling', (req, res) => {
    try {
      res
        .status(200)
        .send(
          trackerController.lightGetPyranometerScaling(
            req.query.instrumentId,
            req.query.groupName
          )
        );
    } catch (e) {
      console.error(e);
      res.status(500).send('Impossible to retrieve the pyranometer scaling');
    }
  });

  app.post('/light.setPyranometerScaling', (req, res) => {
    try {
      trackerController.lightSetPyranometerScaling(
        req.body.instrumentId,
        req.body.groupName,
        req.body.scale,
        req.body.offset
      );
      res.status(200).send('ok');
    } catch (e) {
      console.error(e);
      res.status(500).send('Impossible to set the pyranometer scaling');
    }
  });

  app.post('/light.setPDScaling', (req, res) => {
    trackerController
      .setPDScaling(req.body.instrumentId, req.body.groupName, req.body.pdScale)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.post('/light.setPDOffset', (req, res) => {
    trackerController
      .setPDOffset(req.body.instrumentId, req.body.groupName, req.body.pdOffset)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/light.applyUV', (req, res) => {
    trackerController
      .lightUVCheck(req.query.instrumentId, req.query.groupName)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        res.status(500).send(`Request error: ${error}`);
      });
  });

  app.get('/lightGetControl', function(req, res) {
    try {
      let control = trackerController.getLightControl(
        req.query.instrumentId,
        req.query.groupName
      );
      res.type('application/json').send(JSON.stringify(control));
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .send(`Light control could not be retrieved. Error was ${error}`);
    }
  });

  app.post('/lightSetControl', (req, res) => {
    trackerController
      .setLightControl(
        req.body.instrumentId,
        req.body.groupName,
        req.body.control
      )
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.error(error);
        res.status(500).send(`Cannot save light control. Error was ${error}`);
      });
  });

  app.get('/dcdc.enable', function(req, res) {
    trackerController
      .dcdcEnable(req.query.instrumentId, req.query.groupName)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('DCDC could not be enabled. Error: "' + error + '"');
      });
  });

  app.get('/dcdc.disable', function(req, res) {
    trackerController
      .dcdcDisable(req.query.instrumentId, req.query.groupName)
      .then(() => {
        res.send('');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('DCDC could not be disabled. Error: "' + error + '"');
      });
  });

  app.get('/dcdc.increasePower', function(req, res) {
    trackerController
      .increaseDCDCPower(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.type('application/json').send(JSON.stringify({ dcdcPower: power }));
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('DCDC power could not be increased. Error was "' + error + '"');
      });
  });

  app.get('/dcdc.decreasePower', function(req, res) {
    trackerController
      .decreaseDCDCPower(req.query.instrumentId, req.query.groupName)
      .then(power => {
        console.log(power);
        res.type('application/json').send(JSON.stringify({ dcdcPower: power }));
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('DCDC power could not be decreased. Error was "' + error + '"');
      });
  });

  app.get('/heat.setTarget', function(req, res) {
    trackerController
      .heatSetTarget(
        req.query.instrumentId,
        req.query.groupName,
        req.query.target
      )
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send(
            'Heating target temperature could not be set. Error was "' +
              error +
              '"'
          );
      });
  });

  // pid or fixedPower
  app.get('/heat.setMode', function(req, res) {
    trackerController
      .heatSetMode(req.query.instrumentId, req.query.groupName, req.query.mode)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send(`Heating mode could not be changed. Error was "${error}"`);
      });
  });

  // pid or fixedPower
  app.get('/heat.setPIDParameters', function(req, res) {
    trackerController
      .heatSetPIDParameters(
        req.query.instrumentId,
        req.query.groupName,
        req.query
      )
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        res
          .status(500)
          .send(`Heating mode could not be changed. Error was "${error}"`);
      });
  });

  app.get('/heat.getPIDParameters', function(req, res) {
    try {
      res
        .type('application/json')
        .send(
          trackerController.heatGetPIDParameters(
            req.query.instrumentId,
            req.query.groupName
          )
        );
    } catch (error) {
      console.log(error);
      res
        .status(500)
        .send(`Heating mode could not be changed. Error was "${error}"`);
    }
  });

  app.get('/heat.setHeating', function(req, res) {
    trackerController
      .heatSetHeating(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('Heating could not be enabled. Error was "' + error + '"');
      });
  });

  app.get('/heat.setCooling', function(req, res) {
    trackerController
      .heatSetCooling(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('Cooling could not be enabled. Error was "' + error + '"');
      });
  });



  app.get('/heat.fansOn', function(req, res) {
    trackerController
      .heatFansOn(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('Fans could not be enabled. Error was "' + error + '"');
      });
  });

  app.get('/heat.fansOff', function(req, res) {
    trackerController
      .heatFansOff(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('Fans could not be disabled. Error was "' + error + '"');
      });
  });


  app.get('/heat.setPower', function(req, res) {
    trackerController
      .heatSetPower(
        req.query.instrumentId,
        req.query.groupName,
        req.query.power
      )
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send('Power could not be set. Error was "' + error + '"');
      });
  });

  app.get('/heat.getTemperature', function(req, res) {
    trackerController
      .heatGetTemperature(req.query.instrumentId, req.query.groupName)
      .then(power => {
        res.send('Ok');
      })
      .catch(error => {
        console.log(error);
        console.trace(error);
        res
          .status(500)
          .send(`Cooling could not be enabled. Error was ${error}`);
      });
  });

  app.get('/instrument.setAcquisitionSpeed', (req, res) => {
    trackerController
      .setAcquisitionSpeed(req.query.instrumentId, req.query.groupName)
      .then(speed => {
        res.send(speed);
      })
      .catch(error => {
        console.error(error);
        console.trace(error);
        res
          .status(500)
          .send(`Cannot update the acquisition speed. Error was "${error}"`);
      });
  });

  app.get('/instrument.autoZero', (req, res) => {
    trackerController
      .autoZero(req.query.instrumentId, req.query.channelId)
      .then(() => {
        res.send('ok');
      })
      .catch(error => {
        console.error(error);
        console.trace(error);
        res.status(500).send(`Cannot auto-zero. Error was "${error}"`);
      });
  });

  app.get('/instrument.autoZeroMaster', (req, res) => {
    trackerController
      .autoZeroMaster(req.query.instrumentId, req.query.channelId)
      .then(() => {
        res.send('ok');
      })
      .catch(error => {
        console.error(error);
        console.trace(error);
        res.status(500).send(`Cannot auto-zero. Error was "${error}"`);
      });
  });

  app.post('/measurement.batchIV', (req, res) => {
    trackerController.batchIV(req.query.instrumentId, req.body);
  });

  app.get('/recipes.get', (req, res) => {
    trackerController
      .getRecipes()
      .then(recipes => {
        res.type('application/json').send(recipes);
      })
      .catch(error => {
        res
          .status(500)
          .send('Error while catching the recipes: ' + error.toString());
      });
  });
  app.post('/recipes.save', (req, res) => {
    trackerController
      .addRecipe(req.body.recipeName, req.body.recipe)
      .then(recipes => {
        res.type('application/json').send(recipes);
      })
      .catch(error => {
        res
          .status(500)
          .send('Error while adding the recipe: ' + error.toString());
      });
  });

  app.get('/recipes.remove', (req, res) => {
    trackerController
      .deleteRecipe(req.query.recipeName)
      .then(recipes => {
        res.type('application/json').send(recipes);
      })
      .catch(error => {
        res
          .status(500)
          .send('Error while remove the recipe: ' + error.toString());
      });
  });
};
