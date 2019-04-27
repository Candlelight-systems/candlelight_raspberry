const fs = require('fs');
const HostManager = require('../hostmanager');
const config = require('../config');
const { trackerControllers } = require('../config');
const TrackerController = require('./trackercontroller');
//let allMeasurements = require('./measurements.json');
const wsconnection = require('../wsconnection');

const { recipes, saveRecipes } = require('./recipes');

let instrumentInstances = {};
const allMeasurements = require('./measurements');

for (var i = 0; i < config.hosts.length; i++) {
  if (config.hosts[i].constructorName == 'TrackerController') {
    let host = HostManager.addHost(
      config.hosts[i],
      undefined,
      TrackerController
    );
    instrumentInstances[config.hosts[i].alias] = host;

    host.setInstrumentConfig(trackerControllers.hosts[config.hosts[i].alias]);
    host.init();
  }
}

function getInstrument(alias) {
  if (instrumentInstances[alias]) {
    return instrumentInstances[alias];
  }

  console.error('Instrument ' + alias + " does't exist");
  console.error(Object.keys(instrumentInstances));
  throw new Error('No instrument defined');
}

function lookupChanId(instrumentId, chanNumber) {
  return getInstrument(instrumentId).lookupChanId(chanNumber);
}

function save() {
  fs.writeFileSync(
    './config/trackerControllers.json',
    JSON.stringify(trackerControllers.hosts, undefined, '\t')
  );
}

module.exports = {
  getInstruments() {
    return trackerControllers.hosts;
  },

  getChannels: (instrumentId, groupName) => {
    return getInstrument(instrumentId).getChannels(groupName);
  },

  getGroups: instrumentId => {
    return getInstrument(instrumentId).getGroups();
  },

  getStatus: (instrumentId, chanNumber) => {
    chanNumber = parseInt(chanNumber);
    const chanId = lookupChanId(instrumentId, chanNumber);
    let instrument = getInstrument(instrumentId),
      groups = instrument.getGroups(),
      returnObject = {
        _error: instrument.error
      };

    groups.forEach(group => {
      returnObject[group.groupName] = {
        acquisitionSpeed: instrument.getAcquisitionSpeed(),
        channels: {}
      };

      if (group.heat || group.heatController) {
        returnObject[group.groupName].heatController = true;

        //				returnObject[ group.groupName ].heatingPower = instrument.getHeatingPower( group.groupName );
      }

      if (group.dualOutput) {
        returnObject[group.groupName].dualOutput = true;
        //				returnObject[ group.groupName ].heatingPower = instrument.getHeatingPower( group.groupName );
      }

      if (group.light) {
        returnObject[group.groupName].lightController = true;
      }

      group.channels.forEach(channel => {
        if (chanId && chanId !== channel.chanId) {
          return;
        }

        returnObject[group.groupName].channels[
          channel.chanId
        ] = instrument.getStatus(channel.chanId);
      });
    });

    return returnObject;
  },

  getPDOptions: (instrumentId, groupName) => {
    return getInstrument(instrumentId).getPDOptions(groupName);
  },

  setPDScaling: async (instrumentId, pdRef, pdScale) => {
    await getInstrument(instrumentId).lightSetScaling(pdRef, pdScale);
    fs.writeFileSync(
      './config/trackerControllers.json',
      JSON.stringify(trackerControllers.hosts, undefined, '\t')
    );
  },

  setPDOffset: async (instrumentId, pdRef, pdOffset) => {
    await getInstrument(instrumentId).lightSetOffset(pdRef, pdOffset);
    fs.writeFileSync(
      './config/trackerControllers.json',
      JSON.stringify(trackerControllers.hosts, undefined, '\t')
    );
  },

  getInstrumentConfig: instrumentId => {
    try {
      return getInstrument(instrumentId).getInstrumentConfig();
    } catch (e) {
      console.error('No instrument ' + instrumentId);
    }
  },

  getGroupConfig: (instrumentId, groupName) => {
    return getInstrument(instrumentId).getConfig(groupName, undefined);
  },

  getChannelConfig: (instrumentId, chanNumber) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).getConfig(undefined, chanId);
  },

  executeIV: (instrumentId, chanNumber) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).makeIV(chanId);
  },

  measureVoc: (instrumentId, chanNumber, extend) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).measureVoc(chanId, extend);
  },

  measureJsc: (instrumentId, chanNumber) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).measureJsc(chanId);
  },

  pauseChannels: async instrumentId => {
    const instrument = getInstrument(instrumentId);
    await instrument.pauseChannels();
    let groups = instrument.getInstrumentConfig().groups;
    for (var i = 0, l = groups.length; i < l; i++) {
      await wsconnection.send({
        instrumentId: instrumentId,
        groupName: groups[i].groupName,
        state: {
          paused: true
        }
      });
    }
  },

  resumeChannels: async instrumentId => {
    const instrument = getInstrument(instrumentId);
    await instrument.resumeChannels();
    let groups = instrument.getInstrumentConfig().groups;
    for (var i = 0, l = groups.length; i < l; i++) {
      await wsconnection.send({
        instrumentId: instrumentId,
        groupName: groups[i].groupName,
        state: {
          paused: false
        }
      });
    }
  },

  saveStatus: (instrumentId, chanNumber, status) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    console.log(status);
    return getInstrument(instrumentId).saveStatus(chanId, status);
  },

  resetStatus: (instrumentId, chanNumber, status) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).resetStatus(chanId, status);
  },

  setVoltage: async (instrumentId, chanNumber, voltage) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    await getInstrument(instrumentId).saveStatus(chanId, { tracking_mode: 0 });
    await getInstrument(instrumentId).setVoltage(chanId, voltage);
  },

  measureCurrent: (instrumentId, chanNumber) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    let instrument = getInstrument(instrumentId);
    //let group = instrument.getGroupFromGroupName( groupName );

    //if( ! group.light ) {
    //	throw "This group has no light";
    //}

    if (chanNumber.indexOf('_pd') > -1) {
      //	return instrument.measurePDCurrent( group.light.channelId );
    } else {
      return instrument.measureCurrent(chanId);
    }
  },

  measurePDCurrent: (instrumentId, groupName) => {
    const group = getInstrument(instrumentId).getGroupFromGroupName(groupName);
    return getInstrument(instrumentId).measurePDCurrent(group.light.channelId);
  },

  enableChannel: (instrumentId, chanNumber, noIV) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).enableChannel(chanId, noIV);
  },

  disableChannel: (instrumentId, chanNumber) => {
    const chanId = lookupChanId(instrumentId, chanNumber);
    return getInstrument(instrumentId).disableChannel(chanId);
  },

  setAcquisitionSpeed(instrumentId, speed) {
    return getInstrument(instrumentId).setAcquisitionSpeed(speed);
  },

  dcdcEnable: async (instrumentId, groupName, power) => {
    let instrument = getInstrument(instrumentId);
    await instrument.dcdcEnable(groupName, power);
    await save();
  },

  dcdcDisable: async (instrumentId, groupName, power) => {
    let instrument = getInstrument(instrumentId);
    await instrument.dcdcDisable(groupName, power);
    await save();
  },

  heatIncreasePower: async (instrumentId, groupName) => {
    let instrument = getInstrument(instrumentId);
    await instrument.heatIncreasePower(groupName);
    //await getInstrument( instrumentId ).measureEnvironment();
    await save();
  },

  heatDecreasePower: async (instrumentId, groupName) => {
    let instrument = getInstrument(instrumentId);
    await instrument.heatDecreasePower(groupName);
    //	await getInstrument( instrumentId ).measureEnvironment();
    await save();
  },

  heatSetTarget: async (instrumentId, groupName, target) => {
    await getInstrument(instrumentId).heatSetTarget(groupName, target);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatFansOn: async (instrumentId, groupName) => {
    await getInstrument(instrumentId).heatFansOn(groupName);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatFansOff: async (instrumentId, groupName) => {
    await getInstrument(instrumentId).heatFansOff(groupName);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatSetHeating: async (instrumentId, groupName) => {
    await getInstrument(instrumentId).heatSetHeating(groupName);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatSetMode: async (instrumentId, groupName, mode) => {
    await getInstrument(instrumentId).heatSetMode(groupName, mode);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatSetCooling: async (instrumentId, groupName) => {
    await getInstrument(instrumentId).heatSetCooling(groupName);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatSetPower: async (instrumentId, groupName, power) => {
    await getInstrument(instrumentId).heatSetPower(groupName, power);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  heatGetTemperature: (instrumentId, groupName) => {
    return getInstrument(instrumentId).heatGetTemperature(groupName);
  },

  heatGetPIDParameters: (instrumentId, groupName) => {
    return getInstrument(instrumentId).heatGetPIDParameters(groupName);
  },

  heatSetPIDParameters: async (instrumentId, groupName, parameters) => {
    await getInstrument(instrumentId).heatSetPIDParameters(
      groupName,
      parameters
    );
    await getInstrument(instrumentId).heaterFeedback(groupName);
    await save();
  },

  getAllMeasurements: () => {
    return allMeasurements;
  },

  getMeasurement: measurementName => {
    return allMeasurements[measurementName];
  },

  dropMeasurement: measurementName => {
    if (!allMeasurements[measurementName]) {
      throw `No measurement with the nme ${measurementName} exist`;
    }

    delete allMeasurements[measurementName];
    fs.writeFileSync('./trackercontroller/measurement.json');
  },

  resetSlave(instrumentId) {
    let instrument = getInstrument(instrumentId);
    return instrument.resetSlave();
  },

  getLightControl: (instrumentId, groupName) => {
    let instrument = getInstrument(instrumentId);
    return instrument.lightGetControl(groupName);
  },

  setLightControl: async (instrumentId, groupName, cfg) => {
    await getInstrument(instrumentId).lightSetControl(groupName, cfg);
    await save();
  },

  async lightDisable(instrumentId, groupName) {
    await getInstrument(instrumentId).lightDisable(groupName);
    await getInstrument(instrumentId).measureEnvironment();
    await save();
  },

  async lightEnable(instrumentId, groupName) {
    await getInstrument(instrumentId).lightEnable(groupName);

    await getInstrument(instrumentId).measureEnvironment();

    await save();
  },

  lightIsEnabled(instrumentId, groupName) {
    return getInstrument(instrumentId).lightIsEnabled(groupName);
  },

  lightSetSetpoint(instrumentId, groupName, setpoint) {
    getInstrument(instrumentId).lightSetSetpoint(groupName, setpoint);
    save();
  },

  async lightSetScaling(instrumentId, groupName, scaling) {
    await getInstrument(instrumentId).lightSetScaling(groupName, scaling);
    await save();
  },

  async lightUVCheck(instrumentId, groupName) {
    await getInstrument(instrumentId).lightUVCheck(groupName);
  },

  lightSetPyranometerScaling(instrumentId, groupName, scale, offset) {
    const group = getInstrument(instrumentId).getGroupFromGroupName(groupName);

    if (group.light && group.light.type == 'pyranometer_4_20mA') {
      group.light.scaling = scale;
      group.light.offset = offset;
      save();
      return;
    }

    throw 'No pyranometer for this group';
  },

  lightGetPyranometerScaling(instrumentId, groupName, scaling) {
    const group = getInstrument(instrumentId).getGroupFromGroupName(groupName);

    if (group.light && group.light.type == 'pyranometer_4_20mA') {
      return {
        scale: group.light.scaling,
        offset: group.light.offset
      };
    }

    throw 'No pyranometer for this group';
  },

  autoZero: (instrumentId, chanId) => {
    return getInstrument(instrumentId).autoZero(chanId);
  },

  autoZeroMaster: (instrumentId, chanId) => {
    return getInstrument(instrumentId).autoZeroMaster(chanId);
  },

  batchIV: (instrumentId, parameters) => {
    return getInstrument()._batchIV(parameters);
  },

  getRecipes: async () => {
    console.log(recipes);
    return recipes;
  },

  addRecipe: async (recipeName, recipe) => {
    recipes[recipeName] = recipe;
    return saveRecipes();
  },

  deleteRecipe: async recipeName => {
    delete recipes[recipeName];
    return saveRecipes();
  }
};
