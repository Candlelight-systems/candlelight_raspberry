'use strict';

const fs = require('fs');
const path = require('path');
const extend = require('extend');

const statusPath = path.join(__dirname, './status.json');

if (!fs.existsSync(statusPath)) {
  fs.writeFileSync(statusPath, JSON.stringify({ channels: [] }));
}


const measurements = require("./measurements");


let statusGlobal;
try {
  statusGlobal = require('./status.json');
} catch (e) {
  statusGlobal = { channels: [] };
}

let status = statusGlobal.channels;


const influx = require('./influxhandler');
const globalConfig = require('../config');
const InstrumentController = require('../instrumentcontroller');
const HostManager = require('../hostmanager');
const waveform = require('jsgraph-waveform');
const wsconnection = require('../wsconnection');
const calculateCRC = require('./crc').calculateCRC;

let connections = {};
let intervals = {};
let thermal_modules = {};

thermal_modules.ztp_101t = require('../config/sensors/ztp_101t');

function saveStatus() {
  return fs.writeFileSync(
    './trackercontroller/status.json',
    JSON.stringify(statusGlobal, undefined, '\t')
  );
}

class TrackerController extends InstrumentController {
  constructor(config) {
    super(...arguments);

    this.processTimer = this.processTimer.bind(this);
    this.processTimer();

    this.groupTemperature = {};
    this.groupHumidity = {};
    this.groupLightIntensity = {};
    this.temperatures = {};
    this.lightSetpoint = {};

    this.preventMPPT = {};
    this.pdIntensity = {};

    this.trackData = [];
    this.paused = false;

    this._creation = Date.now();
    this.lightStatusBytes = [];

    this.automaticJVStatus = {
      lastJV: {
        time: [],
        efficiency: []
      },
      currentStatus: [],
      timeStatusStart: []
    };

    this.uvCalibration = false;
  }

  init() {
    this.trackData = [];

    this.openConnection(async () => {
      await this.configure();
    });
  }

  async configure() {
    await delay(2000);
    await this.pauseChannels();
    await this.query('RESERVED:SETUP');
    await this.normalizeStatus();
    await this.resumeChannels();
    await this.scheduleEnvironmentSensing(10000);
    await this.scheduleLightSensing(10000);
    await this.normalizeLightController(); // Normalize the light sensing
    await this.normalizeHeatController(); // Normalize the light sensing
    //		await this.dcdcUpdate(); // Normalize the DC DC converter

    //await this.heatUpdate(); // Normalize the light sensing

    this.setTimer('saveTrackData', '', this.saveTrackData, 60000); // Save the data every 60 seconds
    await this.query('RESERVED:CONFIGURED');
    this.configured = true;
  }

  kill() {
    for (let controller of this.lightControllers) {
      controller.kill();
    }

    super.kill();
  }

  getGroupFromChanId(chanId) {
    const cfg = this.getInstrumentConfig();

    for (var i = 0; i < cfg.groups.length; i++) {
      for (var j = 0; j < cfg.groups[i].channels.length; j++) {
        if (cfg.groups[i].channels[j].chanId == chanId) {
          return cfg.groups[i];
        }
      }
    }
  }

  getGroupFromGroupName(groupName) {
    const cfg = this.getInstrumentConfig();

    for (var i = 0; i < cfg.groups.length; i++) {
      if (cfg.groups[i].groupName == groupName) {
        return cfg.groups[i];
      }
    }

    console.trace();
    throw 'Cannot find the group with group name ' + groupName;
  }

  getInstrumentConfig(groupName, chanId) {
    if (groupName === undefined && chanId === undefined) {
      return super.getInstrumentConfig();
    }

    const cfg = this.getInstrumentConfig();

    for (var i = 0; i < cfg.groups.length; i++) {
      if (cfg.groups[i].groupName == groupName || groupName === undefined) {
        if (chanId === undefined && cfg.groups[i].groupName == groupName) {
          return cfg.groups[i];
        }

        for (var j = 0; j < cfg.groups[i].channels.length; j++) {
          if (cfg.groups[i].channels[j].chanId == chanId) {
            return cfg.groups[i].channels[j];
          }
        }
      }
    }
  }

  /**
   *	Writes a command to the instrument, and adds a trailing EOL
   *	@param {String} command - The command string to send
   */
  query(
    command,
    lines = 1,
    executeBefore,
    prependToQueue = false,
    rawOutput,
    expectedBytes
  ) {
    if (!this.open) {
      console.error('Cannot execute command');
      //throw "Cannot write command \"" + command + "\" to the instrument. The instrument communication is closed."
      return new Promise((resolver, rejecter) => rejecter());
    }

    return super.query(
      command,
      lines,
      executeBefore,
      prependToQueue,
      rawOutput,
      expectedBytes
    );
  }

  /**
   *	Upload the default status of the state
   */
  async normalizeStatus() {
    const cfg = this.getInstrumentConfig(),
      groups = cfg.groups;

    let instrumentId = cfg.instrumentId,
      chanId;

    //await this.setAcquisitionSpeed( statusGlobal.acquisitionSpeed );

    for (var i = 0, m = groups.length; i < m; i++) {
      for (var j = 0, l = groups[i].channels.length; j < l; j++) {
        chanId = groups[i].channels[j].chanId;

        if (!this.statusExists(chanId)) {
          console.log(instrumentId);
          status.push(
            Object.assign(
              {},
              globalConfig.trackerControllers.defaults,
              groups[i].defaults,
              {
                chanId: chanId,
                instrumentId: instrumentId
              }
            )
          );
        }

        await this.updateInstrumentStatusChanId(chanId, {}, true, false);
      }

      if (groups[i].heatController && groups[i].heatController.ssr) {
        await this.heatUpdateSSRTarget(groups[i].groupName);
      }

      if (groups[i].generalRelay && groups[i].heatController.ssr) {
        await this.generalRelayUpdateGroup(groups[i].groupName);
      }
    }

    saveStatus();
  }

  /**
   *	@returns the instrument unique ID
   */
  getInstrumentId() {
    return this.getInstrumentConfig().instrumentId;
  }

  /**
   *	@returns the status of a particular channel
   */
  getStatus(chanId) {
    return status[this.getStatusIndex(chanId)];
  }

  /**
   *	@returns the status index of a particular channel
   */
  getStatusIndex(chanId) {
    for (var i = 0; i < status.length; i++) {
      if (
        status[i].chanId == chanId &&
        status[i].instrumentId == this.getInstrumentId()
      ) {
        return i;
      }
    }
    console.trace();
    throw 'No channel associated with this chanId (' + chanId + ')';
  }

  /**
   *	@returns whether the status of a particular channel exists
   */
  statusExists(chanId) {
    try {
      this.getStatusIndex(chanId);
      return true;
    } catch (e) {
      return false;
    }
  }

  hasChanged(parameter, newValue) {
    if (!Array.isArray(parameter)) {
      parameter = [parameter];
    }

    return _hasChanged(parameter, this.getStatus(), { [parameter]: newValue });
  }

  /**
   *	Forces the update of all channels. Pauses the channel tracking
   */
  async updateAllChannels() {
    await this.pauseChannels();

    for (let i = 0; i < status.length; i++) {
      await updateInstrumentStatusChanId(
        status[i].instrumentId,
        status[i].chanId,
        [],
        true
      );
    }

    await this.resumeChannels();
  }

  async setAcquisitionSpeed(speed) {
    await this.query(
      globalConfig.trackerControllers.specialcommands.acquisition.speed(speed)
    );
    statusGlobal.acquisitionSpeed = speed;
    saveStatus();
  }

  getAcquisitionSpeed() {
    return statusGlobal.acquisitionSpeed;
  }

  async isPaused() {
    return this.query(
      globalConfig.trackerControllers.specialcommands.isPaused,
      2,
      undefined,
      true
    ).then(val => parseInt(val));
  }

  async pauseChannels(keepPaused = false) {
    this.lockPause = keepPaused;

    if (this.paused) {
      return;
    }

    await this.query(
      globalConfig.trackerControllers.specialcommands.pauseHardware,
      1,
      undefined,
      true
    ).then(() => {
      this.paused = true;
    });

    this.eachGroup(group => {
      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        groupName: group.groupName,
        data: { paused: this.paused }
      });
    });
  }

  async resumeChannels(forceUnlock) {
    if (this.lockPause && !forceUnlock) {
      return;
    }

    this.lockPause = false;

    await this.query(
      globalConfig.trackerControllers.specialcommands.resumeHardware,
      1,
      undefined,
      true
    ).then(() => {
      this.paused = false;
    });

    this.eachGroup(group => {
      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        groupName: group.groupName,
        data: { paused: this.paused }
      });
    });
  }

  getGroups() {
    return this.getInstrumentConfig().groups;
  }

  getChannels(groupName = '') {
    for (let group of this.getInstrumentConfig().groups) {
      if (group.groupName == groupName) {
        return group.channels;
      }
    }

    return [];
  }

  setVoltage(chanId, voltageValue) {
    return this.query(
      globalConfig.trackerControllers.specialcommands.setVoltage(
        chanId,
        voltageValue
      )
    );
  }

  async resetStatus(chanId) {
    let index = this.getStatusIndex(chanId);
    let status = this.getStatus(chanId);

    measurementEnd(status.measurementName);

    await this.saveStatus(chanId, globalConfig.trackerControllers.defaults);
    await this.query(
      globalConfig.trackerControllers.specialcommands.reset(chanId)
    );

    status[index] = Object.assign(
      {},
      globalConfig.trackerControllers.defaults,
      { chanId: chanId, instrumentId: this.getInstrumentId() }
    );

    wsconnection.send({
      instrumentId: this.getInstrumentId(),
      chanId: chanId,

      action: {
        stopped: true
      }
    });
  }

  /**
   *	Updates the status of a channel. Uploads it to the instrument and saves it
   *	@param {Number} chanId - The channel ID
   *	@param {Object} newStatus - The new status
   */
  async saveStatus(chanId, newStatus, noSave, noIV) {
    if (this.getInstrumentId() === undefined || chanId === undefined) {
      throw 'Cannot set channel status';
    }

    let previousStatus = Object.assign({}, this.getStatus(chanId));

    // Tracking output interval
    this._setStatus(
      chanId,
      'tracking_record_interval',
      parseInt(newStatus.tracking_record_interval),
      newStatus
    );

    // Tracking sampling interval
    this._setStatus(
      chanId,
      'tracking_interval',
      parseFloat(newStatus.tracking_interval),
      newStatus
    );

    this._setStatus(
      chanId,
      'tracking_measure_voc_interval',
      Math.max(60000, parseInt(newStatus.tracking_measure_voc_interval)),
      newStatus
    );
    this._setStatus(
      chanId,
      'tracking_measure_jsc_interval',
      Math.max(60000, parseInt(newStatus.tracking_measure_jsc_interval)),
      newStatus
    );

    this._setStatus(
      chanId,
      'tracking_measure_voc',
      +newStatus.tracking_measure_voc,
      newStatus
    );
    this._setStatus(
      chanId,
      'tracking_measure_jsc',
      +newStatus.tracking_measure_jsc,
      newStatus
    );

    // Forward - backward threshold
    this._setStatus(
      chanId,
      'tracking_fwbwthreshold',
      Math.min(1, Math.max(0, parseFloat(newStatus.tracking_fwbwthreshold))),
      newStatus
    );

    // Backward - forward threshold
    this._setStatus(
      chanId,
      'tracking_bwfwthreshold',
      Math.min(1, Math.max(0, parseFloat(newStatus.tracking_bwfwthreshold))),
      newStatus
    );

    // Step size
    this._setStatus(
      chanId,
      'tracking_step',
      Math.max(0, parseFloat(newStatus.tracking_stepsize)),
      newStatus
    );

    // Delay upon direction switch
    this._setStatus(
      chanId,
      'tracking_switchdelay',
      Math.max(0, parseFloat(newStatus.tracking_switchdelay)),
      newStatus
    );

    // Acquisition gain
    this._setStatus(
      chanId,
      'tracking_gain',
      parseInt(newStatus.tracking_gain) == -1
        ? -1
        : Math.max(Math.min(128, parseInt(newStatus.tracking_gain))),
      newStatus
    );

    // IV start point
    this._setStatus(
      chanId,
      'iv_start',
      parseFloat(newStatus.iv_start),
      newStatus
    );

    // Autostart IV
    this._setStatus(
      chanId,
      'iv_autostart',
      !!newStatus.iv_autostart,
      newStatus
    );

    // Autostop IV
    this._setStatus(chanId, 'iv_autostop', !!newStatus.iv_autostop, newStatus);

    // IV stop point
    this._setStatus(
      chanId,
      'iv_stop',
      parseFloat(newStatus.iv_stop),
      newStatus
    );

    // IV hysteresis
    this._setStatus(
      chanId,
      'iv_hysteresis',
      !!newStatus.iv_hysteresis,
      newStatus
    );

    // IV scan rate
    this._setStatus(
      chanId,
      'iv_rate',
      Math.max(0.001, parseFloat(newStatus.iv_rate)),
      newStatus
    );

    this._setStatus(chanId, 'connection', newStatus.connection, newStatus);

    this._setStatus(chanId, 'enable', newStatus.enable ? 1 : 0, newStatus);

    // Updates the stuff unrelated to the tracking

    this._setStatus(
      chanId,
      'measurementName',
      newStatus.measurementName,
      newStatus
    );
    this._setStatus(chanId, 'cellName', newStatus.cellName, newStatus);
    this._setStatus(
      chanId,
      'cellArea',
      parseFloat(newStatus.cellArea),
      newStatus
    );
    this._setStatus(
      chanId,
      'lightRefValue',
      parseFloat(newStatus.lightRefValue),
      newStatus
    );

    this._setStatus(
      chanId,
      'correctionFactor_type',
      newStatus.correctionFactor_type,
      newStatus
    );
    this._setStatus(
      chanId,
      'correctionFactor_value',
      parseFloat(newStatus.correctionFactor_value),
      newStatus
    );

    this._setStatus(
      chanId,
      'iv_measurement_interval_type',
      newStatus.iv_measurement_interval_type,
      newStatus
    );
    // IV curve interval
    this._setStatus(
      chanId,
      'iv_interval',
      parseInt(newStatus.iv_interval),
      newStatus
    );
    this._setStatus(
      chanId,
      'iv_measurement_interval_auto_pdrop',
      parseFloat(newStatus.iv_measurement_interval_auto_pdrop),
      newStatus
    );
    this._setStatus(
      chanId,
      'iv_measurement_interval_auto_minTime',
      parseInt(newStatus.iv_measurement_interval_auto_minTime),
      newStatus
    );
    this._setStatus(
      chanId,
      'iv_measurement_interval_auto_maxTime',
      parseFloat(newStatus.iv_measurement_interval_auto_maxTime),
      newStatus
    );

    if (
      newStatus.measurementName !== previousStatus.measurementName &&
      newStatus.measurementName
    ) {
      possibleNewMeasurement(
        newStatus.measurementName,
        newStatus,
        this.getGroupFromChanId(chanId),
        chanId
      );
    }

    let newMode;

    newStatus.tracking_mode = parseInt(newStatus.tracking_mode);
    switch (newStatus.tracking_mode) {
      case 2:
        newMode = 2;
        break;

      case 3:
        newMode = 3;
        break;

      case 1:
        newMode = 1;
        break;

      default:
      case 0:
        newMode = 0;
        break;
    }

    this._setStatus(chanId, 'tracking_mode', newMode, newStatus);

    if (!noSave) {
      saveStatus();
    }

    wsconnection.send({
      instrumentId: this.getInstrumentId(),
      chanId: chanId,

      action: {
        update: true
      }
    });

    await this.updateInstrumentStatusChanId(
      chanId,
      previousStatus,
      undefined,
      undefined,
      noIV
    );
  }

  enableChannel(chanId, noIV) {
    return this.saveStatus(chanId, { enable: true }, true, noIV);
  }

  disableChannel(chanId) {
    return this.saveStatus(chanId, { enable: false });
  }

  isChannelEnabled(chanId) {
    return this.getStatus(chanId).enable;
  }

  measureCurrent(chanId) {
    return this.query(
      globalConfig.trackerControllers.specialcommands.measureCurrent(chanId),
      2
    ).then(current => parseFloat(current));
  }

  _setStatus(chanId, paramName, paramValue, newStatus, save) {
    let instrumentId = this.getInstrumentId();

    if (newStatus && !newStatus.hasOwnProperty(paramName)) {
      return;
    }

    if (!this.statusExists(chanId)) {
      status[chanId] = {
        chanId: chanId,
        instrumentId: instrumentId
      };
    }

    for (var i = 0; i < status.length; i++) {
      if (
        status[i].chanId == chanId &&
        status[i].instrumentId == instrumentId
      ) {
        status[i][paramName] = paramValue;
      }
    }

    if (save) {
      saveStatus();
    }
  }

  async updateInstrumentStatusChanId(
    chanId,
    previousState = {},
    force = false,
    pauseChannels = true,
    noIV = false
  ) {
    let instrumentId = this.getInstrumentId(),
      status = this.getStatus(chanId),
      comm = this.getConnection(),
      group = this.getGroupFromChanId(chanId);

    if (status.enable == 0) {
      this.removeTimer('track', chanId);
      this.removeTimer('voc', chanId);
      this.removeTimer('jsc', chanId);
      this.removeTimer('iv', chanId);
    }

    if (pauseChannels) {
      await this.pauseChannels();
    }

    for (let cmd of globalConfig.trackerControllers.statuscommands) {
      if (!force && cmd[1](status, group) === cmd[1](previousState)) {
        continue;
      }

      await this.query(
        cmd[0] + ':CH' + chanId + ' ' + cmd[1](status, group),
        1,
        undefined,
        true
      );
    }

    if (pauseChannels) {
      await this.resumeChannels();
    }

    if (this.getInstrumentConfig().relayController) {
      if (this.getInstrumentConfig().relayController.host) {
        const relayControllerHost = HostManager.getHost(
          this.getInstrumentConfig().relayController.host
        );

        if (status.connection == 'external') {
          relayControllerHost.enableRelay(chanId);
        } else {
          relayControllerHost.disableRelay(chanId);
        }
      } else {
        await this.query(
          globalConfig.trackerControllers.specialcommands.relay.external(
            chanId,
            status.connection == 'external' ? 1 : 0
          )
        );
      }
    }

    if (status.enable !== 0) {
      // Handle IV scheduling
      if (
        // If there is no timeout yet and there should be one...
        (!this.timerExists('iv', chanId) &&
          Number.isInteger(status.iv_interval)) ||
        // Or if this timeout has changed
        _hasChanged(['iv_interval'], status, previousState)
      ) {
        this.setTimer(
          'iv',
          chanId,
          this.makeIV,
          status.iv_interval,
          undefined,
          chanId => {
            console.log(chanId, this.getConfig(chanId));
            return (
              this.getConfig(chanId).iv_measurement_interval_type !== 'auto'
            );
          }
        );
      }

      // Scheduling Voc. Checks for applicability are done later
      if (
        status.tracking_measure_voc &&
        (!this.timerExists('voc', chanId) ||
          _hasChanged(
            [
              'enabled',
              'tracking_measure_voc',
              'tracking_measure_voc_interval'
            ],
            status,
            previousState
          ))
      ) {
        console.info(`New Voc timer for channel ${chanId}`);
        this.setTimer(
          'voc',
          chanId,
          this.measureVoc,
          status.tracking_measure_voc_interval
        );
      } else {
        this.removeTimer('voc', chanId);
      }

      // Scheduling Jsc. Checks for applicability are done later
      if (
        status.tracking_measure_jsc &&
        (!this.timerExists('jsc', chanId) ||
          _hasChanged(
            [
              'enabled',
              'tracking_measure_jsc',
              'tracking_measure_jsc_interval'
            ],
            status,
            previousState
          ))
      ) {
        this.setTimer(
          'jsc',
          chanId,
          this.measureJsc,
          status.tracking_measure_jsc_interval
        );
      } else {
        this.removeTimer('jsc', chanId);
      }

      var setTrackTimer = () => {
        if (!status.tracking_mode || !status.enable) {
          this.removeTimer('track', chanId);
        } else if (
          !this.timerExists('track', chanId) ||
          (_hasChanged(
            ['enabled', 'tracking_mode', 'tracking_record_interval'],
            status,
            previousState
          ) &&
            status.tracking_record_interval > 0 &&
            status.tracking_mode &&
            status.tracking_record_interval !== null &&
            status.tracking_record_interval !== undefined)
        ) {
          this.setTimer(
            'track',
            chanId,
            this.getTrackDataInterval,
            status.tracking_record_interval
          ); // Setup the timer
        }
      };

      (async () => {
        if (previousState.enable == 0 && status.enable == 1 && !noIV) {
          // Off to tracking

          let iv = await this.makeIV(chanId),
            pow = iv.math((y, x) => {
              return x * y;
            }),
            maxEff = pow.getMax(),
            maxEffLoc = pow.findLevel(maxEff),
            maxEffVoltage = pow.getX(maxEffLoc);

          if (!isNaN(maxEffVoltage)) {
            await this.setVoltage(chanId, maxEffVoltage);
            setTrackTimer();
          } else {
            console.error('Error in finding the maximum voltage');
            setTrackTimer();
          }
        } else {
          setTrackTimer();
        }
      })();
    }
  }

  scheduleEnvironmentSensing(interval) {
    //if( this.timerExists( "pd" ) ) {
    this.setTimer('env', undefined, this.measureEnvironment, interval);
    //}
  }

  //////////////////////////////////////
  // LIGHT MANAGEMENT
  //////////////////////////////////////

  scheduleLightSensing(interval) {
    //if( this.timerExists( "pd" ) ) {

    this.setTimer('light', undefined, this.lightSensing, interval);

    //}
  }

  async eachGroup(method) {
    let groups = this.getInstrumentConfig().groups;
    for (let group of groups) {
      await method(group);
    }
  }

  async measureEnvironment() {
    if (this.uvCalibration) {
      return;
    }

    let groups = this.getInstrumentConfig().groups;
    let temperature, lights, humidity;

    this.eachGroup(async group => {
      let data = {
        paused: await this.isPaused()
      };

      if (group.humiditySensor) {
        const humidity = await this.measureGroupHumidityTemperature(group);

        data.temperature = humidity.temperature;
        data.humidity = humidity.humidity;
      }

      if (group.dcdc) {
        Object.assign(data, {
          heater_voltage:
            Math.round((await this.heaterGetVoltage(group.groupName)) * 100) /
            100,
          heater_current:
            Math.round((await this.heaterGetCurrent(group.groupName)) * 100) /
            100
        });

        data.heater_power =
          Math.round(data.heater_voltage * data.heater_current * 100) / 100;
      }

      if (group.relay_external) {
      }

      if (group.light) {
        switch (group.light.type) {
          case 'pyranometer_4_20mA':
            Object.assign(data, {
              lightValue: await this.measureGroupLightIntensity(group.groupName)
            });

            break;

          case 'photodiode':
          default:

          console.log( await this.measureGroupLightIntensity(group.groupName) );
            Object.assign(data, {
              lightOnOff: group.light.on,
              lightOnOffButton: await this.lightIsEnabled(group.groupName),
              lightMode: (await this.lightIsAutomatic(group.groupName))
                ? 'auto'
                : 'manual',
              lightSetpoint: this.lightSetpoint[group.groupName],
              lightValue: await this.measureGroupLightIntensity(group.groupName)
            });

            break;
        }

        if (group.light.temperature) {
          Object.assign(data, {
            lightTemperature: await this.lightMeasureTemperature(
              group.groupName
            )
          });
        }

        console.log(data);

        if (group.light.uv) {
          switch (group.light.uv.intensityMode) {
            case 'calibration':
              Object.assign(data, {
                lightUVSetpoint: group.light.uv.setPoint
              });

              if (await this.lightIsAutomatic(group.groupName)) {
                Object.assign(data, {
                  lightUVValue: 'Following calibration'
                });
              }

              break;

            case 'sensor':
              Object.assign(data, {
                lightUVSetpoint: group.light.uv.setPoint,
                lightUVValue: await this.lightMeasureUV(group.groupName)
              });

              break;
          }
        }
      }

      if (group.temperatureSensors && Array.isArray(group.temperatureSensors)) {
        for (let sensor of group.temperatureSensors) {
          let thermistor = await this.readBaseTemperature(
            sensor.thermistor,
            group
          );
          let thermopile = await this.readIRTemperature(
            sensor.thermopile,
            group
          );

          for (let chan of sensor.channels) {
            this.temperatures[group.groupName] =
              this.temperatures[group.groupName] || {};
            this.temperatures[group.groupName][chan] = {
              total: Math.round((thermistor + thermopile) * 10) / 10,
              thermistor: Math.round(thermistor * 10) / 10,
              thermopile: Math.round(thermopile * 10) / 10
            };

            console.log(this.temperatures[group.groupName][chan]);
          }
        }

        if (
          group.heatController &&
          group.heatController.feedbackTemperatureSensor
        ) {
          await this.heaterFeedback(group.groupName);
        }

        //throw "No heat controller for this group, or no temperature sensor, or no SSR channel associated";
      }

      if (
        group.heatController &&
        group.heatController.feedbackTemperatureSensor
      ) {
        Object.assign(data, {
          heater_reference_temperature: this.heatGetTemperature(
            group.groupName
          ),
          heater_target_temperature: group.heatController.target,
          heater_power: group.heatController.power,
          heater_cooling: group.generalRelay
            ? group.generalRelay.state == group.heatController.relay_cooling
            : undefined,
          heater_mode: group.heatController.mode
        });
      }

      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        groupName: group.groupName,
        data: data
      });
    });
  }

  updateStatus() {
    // In this case, byte 0 is the overall instrument status, byte 1 the light 1, byte 2 the light 2
    const statusByte = this.statusByte;

    if (!statusByte) {
      return;
    }

    let i = 0;
    let statusLightPositions = [undefined, 1, 2];

    const groups = this.getInstrumentConfig().groups;

    for (let group of groups) {
      const lightStatusByte =
        statusByte[statusLightPositions[group.light.channelId]];
      if (lightStatusByte == this.lightStatusBytes[group.light.channelId]) {
        continue;
      }

      this.lightStatusBytes[group.light.channelId] = lightStatusByte;

      const data = {
        lightOnOffButton: (lightStatusByte & 0b01000000) > 0,
        lightMode: lightStatusByte & 0b00100000 ? 'auto' : 'manual',
        lightOverTemperature: lightStatusByte & 0b00010000
      };
      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        groupName: group.groupName,
        data: data
      });
    }
  }

  async lightSetControl(groupName, control) {
    let group = this.getGroupFromGroupName(groupName);

    if (!group.light) {
      throw 'Cannot update the light controller for this group: a light control must pre-exist.';
    }

    extend(true, group.light, control);

    await this.normalizeLightController(); // Pushes the modifications to the controller board
    //await this.triggerTimerName('light');
    await this.lightSensing(true); // Forces a new recording of the light
    await this.triggerTimerName('env'); //this.measureEnvironment(); // Re-measure the light values, setpoint, and so on
  }

  lightGetControl(groupName) {
    let group = this.getGroupFromGroupName(groupName);
    if (!group.light) {
      throw 'Cannot retrieve the light controller for this group: no light control exists.';
    }

    return group.light;
  }

  async normalizeLightController(force = false) {
    let groups = this.getInstrumentConfig().groups;

    for (let group of groups) {
      if (!group.light) {
        continue;
      }

      if (group.light.control !== false) {
        // Normalization of the light switch
        if (group.light.on) {
          await this.lightEnable(group.groupName);
        } else {
          await this.lightDisable(group.groupName);
        }
      }

      if (group.light.type == 'photodiode' || group.light.type == undefined) {
        // Set the photodiode scaling
        await this.lightSetScaling(group.groupName, group.light.scaling);

        if (!isNaN(group.light.offset)) {
          await this.lightSetOffset(group.groupName, group.light.offset);
        }
      }
    }
  }

  async lightSensing(force = false) {
    if (this.uvCalibration) {
      return;
    }

    let groups = this.getInstrumentConfig().groups;

    // Do nothing while IVs are being recorded
    let IVstatus = parseInt(
      await this.query(
        globalConfig.trackerControllers.specialcommands.iv.status(1),
        2
      )
    );
    if (IVstatus > 0) {
      console.log(IVstatus);
      console.warn('IV curve in progress. Light is not changed');
      return;
    }

    for (let group of groups) {
      if (!group.light) {
        continue;
      }

      if (group.light.scheduling && group.light.scheduling.enable) {
        // Scheduling mode, let's check for new setpoint ?

        // this._scheduling.startDate = Date.now();
        const ellapsed =
          (((Date.now() - this._creation) %
            (group.light.scheduling.basis * 1000)) /
            (group.light.scheduling.basis * 1000)) *
          group.light.scheduling.intensities.length;
        const w = new waveform().setData(group.light.scheduling.intensities);
        const index = w.getIndexFromX(ellapsed);
        const intensityValue = w.getY(index);

        if (intensityValue !== this.lightSetpoint[group.groupName]) {
          await this.lightSetSetpoint(group.groupName, intensityValue);
          this.lightSetpoint[group.groupName] = intensityValue;
        }
      } else if (
        group.light.setPoint !== this.lightSetpoint[group.groupName] ||
        force
      ) {
        await this.lightSetSetpoint(group.groupName, group.light.setPoint);
        this.lightSetpoint[group.groupName] = group.light.setPoint;
      }

      const lightStatusByte = this.lightStatusBytes[group.light.channelId];
      if ((lightStatusByte & 0b11110000) == 0b11110000) {
        await this.lightCheck(group.groupName, force, () => {
          wsconnection.send({
            instrumentId: this.getInstrumentId(),

            log: {
              type: 'info',
              message: `Adjusting light...`
            }
          });

          return true; // Allow method execution
        });

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'info',
            message: `Light adjusted`
          }
        });

        this.measureEnvironment();
      }
    }
  }

  async _lightCommand(groupName, command, value, request, executeBefore) {
    const group = this.getGroupFromGroupName(groupName);

    if (!groupName) {
      throw new Error(`No light configuration for the group ${groupName}`);
    }

    if (group.light.channelId) {
      return this.query(
        globalConfig.trackerControllers.specialcommands.light[command](
          group.light.channelId,
          value
        ),
        request ? 2 : 1,
        executeBefore
      );
    }

    throw new Error(
      `No light channel was defined for the group ${groupName}. Check that the option "channelId" is set and different from null or 0.`
    );
  }

  async lightEnable(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    group.light.on = true;
    const returnValue = this._lightCommand(groupName, 'enable');
    return returnValue;
  }

  async lightDisable(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    group.light.on = false;
    const returnValue = this._lightCommand(groupName, 'disable');
    return returnValue;
  }

  async lightIsEnabled(groupName) {
    return this._lightCommand(groupName, 'isEnabled', undefined, true).then(
      value => value == '1'
    );
  }

  async lightIsAutomatic(groupName) {
    return this._lightCommand(groupName, 'isAutomatic', undefined, true).then(
      value => value == '1'
    );
  }

  async lightMeasureTemperature(groupName) {
    return this._lightCommand(groupName, 'temperature', undefined, true).then(
      value => parseFloat(value)
    );
  }

  async lightSetSetpoint(groupName, setpoint) {
    const group = this.getGroupFromGroupName(groupName);
    group.light.setPoint = setpoint;
    return this._lightCommand(groupName, 'setSetpoint', setpoint);
  }

  async lightSetPWM(groupName, chanId, value) {
    const group = this.getGroupFromGroupName(groupName);
    return this.query(
      globalConfig.trackerControllers.specialcommands.light.setPWM(
        chanId,
        value
      )
    );
  }

  async lightCheck(groupName, force, executeBefore = () => {}) {
    const group = this.getGroupFromGroupName(groupName);
    const light = group.light;

    if (force) {
      return this._lightCommand(
        groupName,
        'forcecheck',
        undefined,
        true,
        executeBefore
      ).then(val => console.log(val));
    } else {
      return this._lightCommand(
        groupName,
        'check',
        undefined,
        true,
        executeBefore
      ).then(val => console.log(val));
    }

    if (light.uv) {
      switch (light.uv.intensityMode) {
        case 'calibration':
          const value =
            light.uv.calibrateOffset +
            light.uv.calibrateGain * light.uv.setPoint;

          if (light.uv.controlMode == 'lightExpander') {
            await this.query(
              globalConfig.trackerControllers.specialcommands.light(
                group.light.channelId,
                value.toFixed(2)
              ),
              request ? 2 : 1
            );
          }

          break;

        case 'sensor':
          if (light.uv.controlMode == 'direct') {
            // UV setting has to be done in the dark and on request
            return;
          }

          break;
      }
    }
  }

  async lightUVCheck(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    const light = group.light;

    this.uvCalibration = true;
    // Turn off white light
    await this._lightCommand(groupName, 'setPWM', 0);

    await delay(1000);

    if (light.uv && light.uv.intensityMode == 'sensor') {
      if (light.uv.controlMode == 'direct') {
        let i = 0;
        while (true) {
          let uvIntensity = await this.lightMeasureUV(groupName);

          wsconnection.send({
            instrumentId: this.getInstrumentId(),
            groupName: groupName,
            data: { lightUVValue: uvIntensity }
          });

          if (Math.abs(light.uv.setPoint - uvIntensity) < 0.5) {
            break;
          }

          if (light.uv.setPoint < uvIntensity) {
            if (light.uv.pwm == 0) {
              break;
            }

            light.uv.pwm -= 4;
          } else {
            if (light.uv.pwm == 4094) {
              break;
            }

            light.uv.pwm += 4;
          }

          await delay(200);

          this.lightSetPWM(groupName, light.uv.channel, light.uv.pwm);

          if (i > 4094) {
            break;
          }
        }
      }
    }

    this.uvCalibration = false;

    // Turn white light back on
    return this._lightCommand(groupName, 'check', undefined, true).then(val =>
      console.log(val)
    );
  }

  async lightSetScaling(groupName, scaling) {
    const group = this.getGroupFromGroupName(groupName);
    group.light.scaling = scaling;
    return this._lightCommand(groupName, 'setScaling', scaling);
  }

  async lightSetOffset(groupName, offset) {
    const group = this.getGroupFromGroupName(groupName);
    group.light.offset = offset;
    return this._lightCommand(groupName, 'setOffset', offset);
  }

  async lightMeasureUV(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    let intensity = parseFloat(
      await this.query(
        globalConfig.trackerControllers.specialcommands.readUVIntensity(
          group.slaveNumber
        ),
        2
      )
    );

    if (intensity > 250) {
      intensity = 'Intensity readout failed';
    }

    return intensity;
  }

  async measureGroupLightIntensity(groupName) {
    const group = this.getGroupFromGroupName(groupName);

    if (!group.light) {
      return null;
    }

    switch (group.light.type) {
      case 'pyranometer_4_20mA':
        const val = await this.measurePyranometer(
          group.light.slaveNumber,
          group.light.address
        );

        if (val > 20 || val < 4) {
          return null;
        }
        return val * group.light.scaling + group.light.offset;
        //await this.query( globalConfig.trackerControllers.specialcommands.i2c.reader_4_20( slaveNumber, i2cAddress )
        break;

      case 'photodiode':
      default:
        if (!group.light.channelId) {
          return null;
        }

        return this.measurePD(group.light.channelId);
        break;
    }

    return null;
  }

  async measureChannelLightIntensity(channelId) {
    const group = this.getGroupFromChanId(channelId);
    const lightIntensity = await this.measureGroupLightIntensity(
      group.groupName
    );
    const status = this.getStatus(channelId);

    switch (status.correctionFactor_type) {
      case 'factory':
        let cfg = this.getInstrumentConfig(group.groupName, channelId);
        return lightIntensity * (cfg.correctionFactor || 1);
        break;

      case 'manual':
        return lightIntensity * status.correctionFactor_value;
        break;

      default:
        return lightIntensity;
        break;
    }
    /*const channelIdPD = group.light.channelId;
		return this.measurePD( channelIdPD );*/
  }

  async getChannelLightIntensity(chanId, defaultValue) {
    const status = this.getStatus(chanId);

    if (status.lightRefValue) {
      // If the value is forced
      return status.lightRefValue / 1000;
    }

    if (defaultValue) {
      // If there's already a default value
      return defaultValue;
    }

    return this.measureChannelLightIntensity(chanId);
  }

  async measurePD(channelId) {
    return parseFloat(
      await this.query(
        globalConfig.trackerControllers.specialcommands.readPD.sun(channelId),
        2
      )
    );
  }

  async measurePDCurrent(channelId) {
    return parseFloat(
      await this.query(
        globalConfig.trackerControllers.specialcommands.readPD.current(
          channelId
        ),
        2
      )
    );
  }

  async measurePyranometer(slaveNumber, i2cAddress) {
    return parseFloat(
      await this.query(
        globalConfig.trackerControllers.specialcommands.i2c.reader_4_20(
          slaveNumber,
          i2cAddress
        ),
        2
      )
    );
  }

  async resetSlave() {
    return this.query(
      globalConfig.trackerControllers.specialcommands.resetSlave
    );
  }

  //***************************//
  // TEMPERATURE READING ******//
  //***************************//

  async readBaseTemperature(cfg, group) {
    const t0 = 273.15;
    const buffer = await this.query(
      globalConfig.trackerControllers.specialcommands.readTemperatureChannelBase(
        group.slaveNumber,
        cfg.I2CAddress,
        cfg.ADCChannel
      ),
      2,
      undefined,
      false,
      true,
      2
    );

    if (buffer[0] == 0x00 && buffer[1] == 0x00) {
      // Sensor did not respond
      return undefined;
    }

    const int = buffer.readInt16BE(0) / 16;
    const vout = (int / 2047) * 2.048; // 12 bit word ( 0 - 2047 ) * PGA value (2.048V)
    const thermistor = (vout * cfg.resistor) / (cfg.vref - vout);
    const t =
      (1 / (25 + t0) +
        (1 / thermal_modules[cfg.model].thermistor.beta) *
          Math.log(thermistor / thermal_modules[cfg.model].thermistor.r0)) **
        -1 -
      t0;

    return t;
  }

  async readIRTemperature(cfg, group) {
    const buffer = await this.query(
      globalConfig.trackerControllers.specialcommands.readTemperatureChannelIR(
        group.slaveNumber,
        cfg.I2CAddress,
        cfg.ADCChannel
      ),
      2,
      undefined,
      false,
      true,
      2
    );

    if (buffer[0] == 0x00 && buffer[1] == 0x00) {
      // Sensor did not respond
      return 0;
    }
    //		console.log( buffer.readInt16BE( 0 ), buffer.readInt16BE( 0 ) / 16 / 2047 * 2.048 );
    let vout =
      (((buffer.readInt16BE(0) / 16 - cfg.offset) / 2047) * 2.048) / cfg.gain; // Sensor voltage

    const coeffs = thermal_modules[cfg.model].thermopile.polynomialCoefficients;
    vout *= 1000;
    const deltaT =
      coeffs[0] * 0 + // Rescale to 0
      +(vout ** 1) * coeffs[1] +
      vout ** 2 * coeffs[2] +
      vout ** 3 * coeffs[3] +
      vout ** 4 * coeffs[4] +
      vout ** 5 * coeffs[5] +
      vout ** 6 * coeffs[6] +
      vout ** 7 * coeffs[7] +
      vout ** 8 * coeffs[8];

    return deltaT;
  }

  getSensorConfig(chanId) {
    const group = this.getGroupFromChanId(chanId);
    const temperatureSensors = group.temperatureSensors;
    for (let sensor of temperatureSensors) {
      if (sensor.channels.indexOf(chanId) > -1) {
        return sensor;
      }
    }
  }

  getGroupTemperature(groupName) {
    return this.groupTemperature[groupName];
  }

  async measureGroupHumidityTemperature(group) {
    let data = await this.query(
      globalConfig.trackerControllers.specialcommands.readHumidity(
        group.slaveNumber,
        group.humiditySensor.address
      ),
      3
    );

    this.groupHumidity[group.groupName] =
      Math.round(1000 * parseFloat(data[1])) / 10;
    this.groupTemperature[group.groupName] =
      Math.round(10 * parseFloat(data[0])) / 10;

    return {
      humidity: this.groupHumidity[group.groupName],
      temperature: this.groupTemperature[group.groupName]
    };
  }

  getGroupHumidity(groupName) {
    return this.groupHumidity[groupName];
  }

  //////////////////////////////////////
  // IV CURVES
  //////////////////////////////////////

  processTimer() {
    let now;

    try {
      for (var i in intervals) {
        now = Date.now();

        if (
          now - intervals[i].lastTime > intervals[i].interval &&
          intervals[i].activated &&
          !intervals[i].processing
        ) {
          if (!this.paused) {
            this.triggerTimer(i);
          }
        }
      }
    } catch (e) {}

    setTimeout(this.processTimer, 1000);
  }

  triggerTimerName(timerName, chanId = undefined) {
    const intervalId = this.getIntervalName(timerName, chanId);
    this.triggerTimer(intervalId);
  }

  triggerTimer(i) {
    if (!intervals[i]) {
      console.error('No interval defined for: ' + i);
      return;
    }
    intervals[i].lastTime = Date.now();
    // Removed the "await", which could hang other processes
    this.processCallback(intervals[i]);
  }

  async processCallback(interval) {
    intervals.processing = true;
    try {
      if (typeof interval.beforeCall == 'function') {
        if (!(await interval.beforeCall(interval.chanId))) {
          interval.lastTime = Date.now();
          interval.processing = false;
          return;
        }
      }
      await interval.callback(interval.chanId);
    } catch (error) {
      console.error(error);
    } finally {
      interval.lastTime = Date.now();
      interval.processing = false;
    }
  }

  setTimer(
    timerName,
    chanId,
    callback,
    interval,
    lastTime = Date.now(),
    beforeCall
  ) {
    // Let's set another time
    const intervalId = this.getIntervalName(timerName, chanId);

    callback = callback.bind(this);

    intervals[intervalId] = {
      interval: interval,
      chanId: chanId,
      lastTime: lastTime,
      activated: true,
      callback: callback,
      beforeCall: beforeCall
    };
  }

  getTimerNext(timerName, chanId, defaultValue = undefined) {
    const intervalId = this.getIntervalName(timerName, chanId);

    if (!intervals[intervalId] || !intervals[intervalId].activated) {
      return defaultValue;
    }

    return (
      intervals[intervalId].interval +
      intervals[intervalId].lastTime -
      Date.now()
    );
  }

  async saveTrackData() {
    let chans = new Set();

    if (!Array.isArray(this.trackData) || this.trackData.length == 0) {
      return;
    }

    try {
      await influx.saveTrackData(
        this.trackData.map(data => {
          chans.add(data.chanId);
          return data.influx;
        })
      );
    } catch (error) {
      console.error(error);
      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        log: {
          type: 'error',
          message: `Did not manage to save the tracking data into the database. Check that it is running and accessible.`
        }
      });
    }

    chans.forEach(chan => {
      wsconnection.send({
        instrumentId: this.getInstrumentId(),
        chanId: chan,
        action: {
          saved: true
        }
      });
    });

    this.trackData = [];
  }

  getIntervalName(timerName, chanId) {
    return this.getInstrumentId() + '_' + chanId + '_' + timerName;
  }

  getTimer(timerName, chanId) {
    const intervalName = this.getIntervalName(timerName, chanId);

    if (!intervals[intervalName]) {
      throw 'The timer with id ' + intervals[timerName] + '';
    }

    return intervals[intervalName];
  }

  timerExists(timerName, chanId) {
    return (
      !!intervals[this.getIntervalName(timerName, chanId)] &&
      intervals[this.getIntervalName(timerName, chanId)].activated === true
    );
  }

  removeTimer(timerName, chanId) {
    if (!this.timerExists(timerName, chanId)) {
      return;
    }

    intervals[this.getIntervalName(timerName, chanId)].activated = false;
  }

  //////////////////////////////////////
  // IV CURVES
  //////////////////////////////////////

  async makeIV(chanId) {
    let light;
    const cfg = this.getInstrumentConfig();

    try {
      const stateName =
        cfg.board_version && cfg.board_version < 80
          ? 'IV_once'
          : 'state_' + chanId;
      return this.getManager(stateName).addQuery(async () => {
        //this._setStatus( chanId, 'iv_booked', true, undefined, true );

        var status = this.getStatus(chanId);
        this.preventMPPT[chanId] = true;

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'info',
            channel: chanId,
            message: `Request j-V sweep`
          }
        });

        if (!this.isChannelEnabled(chanId)) {
          throw 'Channel not enabled';
        }

        let startTime = Date.now();
        let safetyExpiracy = 1000 * 300; // 300 seconds max = 5 minutes.

        await this.getManager('IV').addQuery(async () => {
          return this.query(
            globalConfig.trackerControllers.specialcommands.iv.execute(chanId),
            1
          );
        });
        await this.delay(3000);

        while (true) {
          if (Date.now() - startTime > safetyExpiracy) {
            this.error('Timeout for j-V curve', chanId);
          }

          if (!this.isChannelEnabled(chanId)) {
            this.error(
              'Channel not enabled. Cannot continue the j-V curve',
              chanId
            );
          }

          let status = parseInt(
            await this.query(
              globalConfig.trackerControllers.specialcommands.iv.status(chanId),
              2
            )
          );
          console.log(status);
          if (status & 0b00000001) {
            // If this particular jv curve is still running

            wsconnection.send({
              instrumentId: this.getInstrumentId(),

              log: {
                type: 'info',
                channel: chanId,
                message: `j-V sweep in progress`
              }
            });

            await this.delay(1000);
            continue;
          }

          break; // That one IV curve has stopped

          // Now we must ask the IV manager to fetch them all and pause any new start
        }

        // This will delay any further jV curve beginning until they are all done
        let data = await this.getManager('IV').addQuery(async () => {
          let data;

          while (true) {
            if (!this.isChannelEnabled(chanId)) {
              this.error(
                'Channel not enabled. Cannot continue the j-V curve',
                chanId
              );
            }

            if (Date.now() - startTime > safetyExpiracy) {
              this.error('Timeout for j-V curve', chanId);
            }

            try {
              let status = parseInt(
                await this.query(
                  globalConfig.trackerControllers.specialcommands.iv.status(
                    chanId
                  ),
                  2
                )
              );

              if (status & 0b00000010) {
                // When ALL jV curves are done
                await this.delay(1000);

                wsconnection.send({
                  instrumentId: this.getInstrumentId(),
                  log: {
                    type: 'info',
                    channel: chanId,
                    message: `Waiting for all j-V sweeps to terminate`
                  }
                });

                continue;
              }

              data = await this.query(
                globalConfig.trackerControllers.specialcommands.iv.data(chanId),
                2
              );

              data = data
                .replace('"', '')
                .replace('"', '')
                .split(',');

              data.pop();

              wsconnection.send({
                instrumentId: this.getInstrumentId(),
                log: {
                  type: 'info',
                  channel: chanId,
                  message: `j-V sweep terminated`
                }
              });

              data.shift();
              light = await this.getChannelLightIntensity(chanId);
            } catch (e) {
              this.preventMPPT[chanId] = false; // Worst case scenario, we need to make sure we disable the MPP preventer
            }

            break;
          }

          return data;
        });

        if (isNaN(light)) {
          this.error(
            `Light intensity could not be determined. The j-V curve won't be saved`,
            chanId
          );
        } else {
          try {
            //	console.log( data, light );

            await this.lease(async () => {
              try {
                await influx.storeIV(status.measurementName, data, light);
              } catch (e) {
                this.error(
                  `Did not manage to save the j(V) curve into the database. Check that it is running and accessible.`,
                  chanId
                );
              }
            });
            //await influx.storeIV( status.measurementName, data, light );

            wsconnection.send({
              instrumentId: this.getInstrumentId(),
              log: {
                type: 'info',
                channel: chanId,
                message: `j-V sweep saved into the database`
              }
            });
          } catch (error) {
            console.error(error);
            this.error(
              `Did not manage to save the j(V) curve into the database. Check that it is running and accessible.`,
              chanId
            );
            this.preventMPPT[chanId] = false; // Worst case scenario, we need to make sure we disable the MPP preventer
          }

          wsconnection.send({
            instrumentId: this.getInstrumentId(),
            chanId: chanId,

            action: {
              ivCurve: true
            }
          });
        }

        this.preventMPPT[chanId] = false;
        //		this._setStatus( chanId, 'iv_booked', false, undefined, true );

        const wave = new waveform();

        for (let i = 0; i < data.length; i += 2) {
          wave.append(data[i], data[i + 1]);
        }

        return wave;
      });
    } catch (e) {
      this.preventMPPT[chanId] = false; // Worst case scenario, we need to make sure we disable the MPP preventer
    }
  }

  //////////////////////////////////////
  // END IV CURVES
  //////////////////////////////////////

  //////////////////////////////////////
  // TRACK DATA
  //////////////////////////////////////

  async _getTrackData(chanId, iterator = 0) {
    if (this.uvCalibration) {
      return;
    }

    const cfg = this.getInstrumentConfig();

    const data = await this.query(
      globalConfig.trackerControllers.specialcommands.getTrackData(chanId),
      2,
      () => {
        return (
          this.getStatus(chanId).enable && this.getStatus(chanId).tracking_mode
        );
      },
      false,
      true,
      cfg.crc_check ? 39 : 38
    );

    if (cfg.crc_check) {
      if (calculateCRC(data, 38) !== data[38]) {
        this.error('Data corruption. Retrying...', chanId);

        if (iterator == 10) {
          this.error(
            "Data corruption doesn't seem to resolve itself. Abandoning...",
            chanId
          );
          throw 'Data corruption';
        } else {
          return this._getTrackData(chanId, iterator + 1);
        }
      }

      //				await this.query( globalConfig.trackerControllers.specialcommands.trackingResetData( chanId ) );
    } else {
      //				await this.query( globalConfig.trackerControllers.specialcommands.trackingResetData( chanId ) );
    }

    //console.log( data, data.length );
    // data is buffer
    let out = [];
    for (var i = 0; i < 9; i++) {
      out.push(data.readFloatLE(i * 4)); // New float every 4 byte
    }

    out.push(data.readUInt8(9 * 4)); // Byte 32 has data
    out.push(data.readUInt8(9 * 4 + 1)); // Byte 33 has data

    return out;
  }

  async getTrackDataInterval(chanId) {
    const status = this.getStatus(chanId);
    const group = this.getGroupFromChanId(chanId);

    if (this.preventMPPT[chanId]) {
      return;
    }

    let data = await this._getTrackData(chanId);
    let temperature;

    if (
      this.temperatures[group.groupName] &&
      this.temperatures[group.groupName][chanId]
    ) {
      temperature = this.temperatures[group.groupName][chanId];
    } else {
      temperature = { thermistor: this.groupTemperature[group.groupName] };
    }

    data = data.map(el => parseFloat(el));

    const voltageMean = data[0],
      currentMean = data[1],
      powerMean = data[2],
      voltageMin = data[3],
      currentMin = data[4],
      powerMin = data[5],
      voltageMax = data[6],
      currentMax = data[7],
      powerMax = data[8],
      nb = data[9],
      pga = data[10];

    for (var i = 0; i < 9; i++) {
      if (data[i] > 100) {
        console.warn('Data out of range for chan ' + chanId, nb, i);
        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'warning',
            channel: chanId,
            message:
              'Data out of range for this channel. Probably a communication error'
          }
        });
      }
    }

    if (nb == 0) {
      console.warn('No points collected for chan ' + chanId, nb);

      wsconnection.send({
        instrumentId: this.getInstrumentId(),

        log: {
          type: 'warning',
          channel: chanId,
          message:
            'No data point for this channel. You should reboot the instrument if this problem persists'
        }
      });

      return;
    }

    //results[9] in sun (1 / 1000 W m^-2)
    // powerMean in watt

    const lightChannel = group.light.channelId;
    const sun = await this.getChannelLightIntensity(chanId);

    const efficiency =
      (powerMean / (status.cellArea / 10000) / (sun * 1000)) * 100;

    if (isNaN(efficiency) || !isFinite(efficiency)) {
      console.error(
        'Efficiency has the wrong format. Check lightRef value: ' + sun
      );
      return;
    }

    this.automaticJV(chanId, efficiency);

    wsconnection.send({
      instrumentId: this.getInstrumentId(),
      chanId: chanId,

      state: {
        voltage: voltageMean,
        current: currentMean,
        power: powerMean,
        efficiency: efficiency,
        sun: sun,
        temperature:
          temperature && temperature.thermistor ? temperature.thermistor : -1,
        temperature_junction:
          temperature && temperature.total ? temperature.total : -1,
        humidity: isNaN(this.groupHumidity[group.groupName])
          ? -1
          : this.groupHumidity[group.groupName]
      },

      action: {
        data: efficiency
      },

      timer: {
        iv: this.getTimerNext('iv', chanId, null),
        voc: this.getTimerNext('voc', chanId, null),
        jsc: this.getTimerNext('jsc', chanId, null),
        aquisition: 0,
        ellapsed: Date.now() - measurements[status.measurementName].startDate
      },

      log: {
        type: 'info',
        channel: chanId,
        message: 'Getting tracking info'
      }
    });

    const fields = {
      voltage_min: voltageMin,
      voltage_mean: voltageMean,
      voltage_max: voltageMax,
      current_min: currentMin,
      current_mean: currentMean,
      current_max: currentMax,
      power_min: powerMin,
      power_mean: powerMean,
      power_max: powerMax,
      efficiency: efficiency,
      sun: sun,
      pga: pga,
      temperature_base:
        temperature && temperature.thermistor ? temperature.thermistor : 0,
      temperature_junction:
        temperature && temperature.total ? temperature.total : 0,
      humidity: this.groupHumidity[group.groupName]
    };

    if (sun < 0) {
      delete fields.sun;
    }

    if (isNaN(this.groupHumidity[group.groupName])) {
      delete fields.humidity;
    }

    if (!temperature || isNaN(temperature.thermistor)) {
      delete fields.temperature_base;
    }

    if (!temperature || isNaN(temperature.total)) {
      delete fields.temperature_junction;
    }

    this.trackData.push({
      chanId: chanId,
      influx: {
        measurement: encodeURIComponent(status.measurementName),
        timestamp: Date.now() * 1000000, // nano seconds
        fields: fields
      }
    });
  }

  async automaticJV(chanId, pce) {
    const config = this.getStatus(chanId);

    if (config.iv_measurement_interval_type !== 'auto') {
      return;
    }

    const now = Date.now();

    // Does not exist yet. Create and quit method
    if (!this.automaticJVStatus.lastJV.time[chanId]) {
      this.automaticJVStatus.lastJV.time[chanId] = now;
      this.automaticJVStatus.lastJV.efficiency[chanId] = pce;
      return;
    }

    // Below the minimum interval
    if (
      now - this.automaticJVStatus.lastJV.time[chanId] <
      config.iv_measurement_interval_auto_minTime
    ) {
      return;
    }

    // Above the maximum interval
    if (
      now - this.automaticJVStatus.lastJV.time[chanId] >
      config.iv_measurement_interval_auto_maxTime
    ) {
      await this.makeIV(chanId);
      this.automaticJVStatus.lastJV.time[chanId] = Date.now();
      this.automaticJVStatus.lastJV.efficiency[chanId] = pce;
      return;
    }

    // Get the PCE for the last jV curve
    const lastPCE = this.automaticJVStatus.lastJV.efficiency[chanId];

    // Calculate the ratio
    const pceRatio = Math.abs(pce - lastPCE) / lastPCE;

    if (!config.iv_measurement_interval_auto_pdrop) {
      return;
    }

    // Above the threshold. Check further if that was the case in the last minute
    if (pceRatio * 100 < config.iv_measurement_interval_auto_pdrop) {
      this.automaticJVStatus.currentStatus[chanId] = -1; // Reset as under threshold
      return;
    }

    // Previous status doesn't exist yet. Create
    if (!this.automaticJVStatus.currentStatus[chanId]) {
      this.automaticJVStatus.currentStatus[chanId] = -1; // Set as "Under threshold"
    }

    // We just went over the threshold => Start the clock
    if (this.automaticJVStatus.currentStatus[chanId] == -1) {
      this.automaticJVStatus.timeStatusStart[chanId] = now;
      this.automaticJVStatus.currentStatus[chanId] = pce > lastPCE ? 2 : 1;
      return;
    }

    // Over the last PCE BUT the status byte indicates under PCE or the reverse
    if (
      (pce > lastPCE && this.automaticJVStatus.currentStatus[chanId] == 1) ||
      (pce < lastPCE && this.automaticJVStatus.currentStatus[chanId] == 2)
    ) {
      this.automaticJVStatus.currentStatus[chanId] = -1; // Set as "Under threshold"
      return;
    }

    if (now - this.automaticJVStatus.timeStatusStart[chanId] < 60000) {
      return;
    }

    // Ok seems like all conditions have passed. Make the curve !
    await this.makeIV(chanId);
    this.automaticJVStatus.lastJV.time[chanId] = Date.now();
    this.automaticJVStatus.lastJV.efficiency[chanId] = pce;
    this.automaticJVStatus.currentStatus[chanId] = -1;
  }

  async measureVoc(chanId, extend) {
    console.info(`Measuring open circuit voltage on channel ${chanId}`);
    wsconnection.send({
      instrumentId: this.getInstrumentId(),
      log: {
        type: 'info',
        channel: chanId,
        message: `Requesting an open circuit voltage measurement.`
      }
    });

    return this.getManager('state_' + chanId).addQuery(async () => {
      const status = this.getStatus(chanId);
      // Save the current mode
      const statusSaved = status.tracking_mode,
        intervalSaved = status.tracking_interval,
        gainSaved = status.tracking_gain;

      this.preventMPPT[chanId] = true;

      // Change the mode to Voc tracking, with low interval
      // Update the cell status. Wait for it to be done

      try {
        await this.query(
          globalConfig.trackerControllers.specialcommands.voc.trigger(chanId)
        );
        /*
					let triggered = await this.query( globalConfig.trackerControllers.specialcommands.voc.trigger( chanId ), 2 );
					if( triggered == 0 ) {
						return;
					}
	*/
        let i = 0;
        while (
          (await this.query(
            globalConfig.trackerControllers.specialcommands.voc.status(chanId),
            2
          )) == '1'
        ) {
          i++;

          if (i > 20) {
            wsconnection.send({
              instrumentId: this.getInstrumentId(),
              log: {
                type: 'error',
                channel: chanId,
                message: `Failed to find the open circuit voltage.`
              }
            });

            break;
          }
          await delay(1000); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
        }

        let voc = await this.query(
          globalConfig.trackerControllers.specialcommands.voc.data(chanId),
          2
        ).then(val => parseFloat(val));

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'info',
            channel: chanId,
            message: `Open circuit voltage found: ${voc}V.`
          }
        });

        console.info(`Voc for channel ${chanId}: ${voc}`);

        try {
          await this.lease(() => {
            return influx.storeVoc(status.measurementName, voc);
          });
        } catch (error) {
          console.log(error);

          wsconnection.send({
            instrumentId: this.getInstrumentId(),
            log: {
              type: 'error',
              message: `Did not manage to save the open circuit voltage into the database. Check that it is running and accessible.`
            }
          });

          this.preventMPPT[chanId] = false;
        }

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          chanId: chanId,
          state: {
            voc: voc
          },

          timer: {
            voc: this.getTimerNext('voc', chanId)
          }
        });

        await delay(5000); // Re equilibration
      } catch (error) {
        console.error(error);

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'error',
            message: `An unknown error occured while measurement the open circuit voltage.`
          }
        });
      }

      this.preventMPPT[chanId] = false;
    });
  }

  async measureJsc(chanId, extend) {
    // Cannot do it while measuring a j-V curve

    wsconnection.send({
      instrumentId: this.getInstrumentId(),
      log: {
        type: 'info',
        channel: chanId,
        message: `Requesting a short circuit current measurement.`
      }
    });

    return this.getManager('state_' + chanId).addQuery(async () => {
      const status = this.getStatus(chanId);
      // Save the current mode
      const statusSaved = status.tracking_mode,
        intervalSaved = status.tracking_interval,
        gainSaved = status.tracking_gain;

      this.preventMPPT[chanId] = true;

      try {
        // Change the mode to Voc tracking, with low interval
        // Update the cell status. Wait for it to be done
        await this.query(
          globalConfig.trackerControllers.specialcommands.jsc.trigger(chanId)
        );
        /*let triggered = await this.query( globalConfig.trackerControllers.specialcommands.jsc.trigger( chanId ), 2 );
					if( triggered == 0 ) {
						return;
					}
	*/
        let i = 0;
        while (
          (await this.query(
            globalConfig.trackerControllers.specialcommands.jsc.status(chanId),
            2
          )) == '1'
        ) {
          i++;

          if (i > 20) {
            wsconnection.send({
              instrumentId: this.getInstrumentId(),
              log: {
                type: 'error',
                channel: chanId,
                message: `Failed to find the short circuit current.`
              }
            });

            break;
          }

          await delay(1000); // Let's wait 1 second until the next one. In the meantime, no MPP data is measured (see preventMPPT)
        }

        let jsc = await this.query(
          globalConfig.trackerControllers.specialcommands.jsc.data(chanId),
          2
        ).then(val => parseFloat(val));

        try {
          await this.lease(() => {
            return influx.storeJsc(status.measurementName, jsc);
          });
        } catch (error) {
          wsconnection.send({
            instrumentId: this.getInstrumentId(),
            log: {
              type: 'error',
              message: `Did not manage to save the short circuit current into the database. Check that it is running and accessible.`
            }
          });

          this.preventMPPT[chanId] = true;
        }

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'info',
            channel: chanId,
            message: `Short circuit voltage found: ${jsc}A.`
          }
        });

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          chanId: chanId,
          state: {
            jsc: jsc // in mA (not normalized by area)
          },

          timer: {
            jsc: this.getTimerNext('jsc', chanId)
          }
        });

        await delay(5000); // Re equilibration
      } catch (error) {
        console.error(error);

        wsconnection.send({
          instrumentId: this.getInstrumentId(),
          log: {
            type: 'error',
            message: `An unknown error occured while measurement the short circuit current.`
          }
        });
      }
      this.preventMPPT[chanId] = false;
    });
  }

  lookupChanId(chanNumber) {
    return chanNumber;
    /*if( this.getInstrumentConfig().channelLookup[ chanNumber ] ) {
			return this.getInstrumentConfig().channelLookup[ chanNumber ]
		}*/
  }

  //*************************************//
  //*** NEW VERSION OF HEAT CONTROLLER **//
  //*************************************//

  async normalizeHeatController(force = false) {
    let groups = this.getInstrumentConfig().groups;

    for (let group of groups) {
      if (!group.heatController) {
        continue;
      }
      console.log(group.heatController);

      if (group.heatController.target) {
        await this.heatUpdateSSRTarget(group.groupName);
      }

      if (group.heatController.relay && group.generalRelay) {
        if (group.generalRelay.state == group.heatController.relay_heating) {
          await this.heatSetHeating(group.groupName);
        } else if (
          group.generalRelay.state === group.heatController.relay_cooling
        ) {
          await this.heatSetCooling(group.groupName);
        }
      } else if (group.heatController.mode_heating == true) {
        await this.heatSetHeating(group.groupName);
      } else if (group.heatController.mode_cooling == true) {
        await this.heatSetCooling(group.groupName);
      }

      if (group.heatController.ssr) {
        this.normalizeHeatControllerSSR(group.groupName, force);
      } else if (group.heatController.dcdc) {
        this.normalizeHeatControllerDCDC(); // Normalize the light sensing
      }
    }
  }

  async normalizeHeatControllerSSR(groupName, force) {
    const group = this.getGroupFromGroupName(groupName);

    if (!group.heatController.pid) {
      return new Promise((resolver, rejecter) => resolver());
    }

    //	await this.query( globalConfig.trackerControllers.specialcommands.heat.enable( group.ssr.channelId ) );

    if (group.heatController.pid.kp_heating !== undefined) {
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_kp(
          group.ssr.channelId,
          'heating',
          group.heatController.pid.kp_heating
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_kd(
          group.ssr.channelId,
          'heating',
          group.heatController.pid.kd_heating
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_ki(
          group.ssr.channelId,
          'heating',
          group.heatController.pid.ki_heating
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_bias(
          group.ssr.channelId,
          'heating',
          group.heatController.pid.bias_heating
        )
      );
    }

    if (group.heatController.pid.kp_cooling !== undefined) {
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_kp(
          group.ssr.channelId,
          'cooling',
          group.heatController.pid.kp_cooling
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_kd(
          group.ssr.channelId,
          'cooling',
          group.heatController.pid.kd_cooling
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_ki(
          group.ssr.channelId,
          'cooling',
          group.heatController.pid.ki_cooling
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.pid_bias(
          group.ssr.channelId,
          'cooling',
          group.heatController.pid.bias_cooling
        )
      );
    }
  }

  async heatSetTarget(groupName, target) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.heatController) {
      group.heatController.target = target;

      if (group.heatController.ssr) {
        await this.heatUpdateSSRTarget(groupName);
      }

      return;
    }

    throw new Error('No heat controller defined for this group');
  }

  // Set the target in the SSR command for hardware implementation
  heatUpdateSSRTarget(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.heatController && group.heatController.ssr) {
      return this.query(
        globalConfig.trackerControllers.specialcommands.heat.target(
          group.ssr.channelId,
          group.heatController.target
        )
      );
    }

    throw new Error(
      'No heat controller defined for this group or no SSR channel assigned'
    );
  }

  async heatSetHeating(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (
      group.heatController &&
      group.heatController.relay &&
      group.generalRelay
    ) {
      group.generalRelay.state = group.heatController.relay_heating;
      await this.generalRelayUpdateGroup(groupName);

      // We still need to tell the PID that we're heating up
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.heating(
          group.ssr.channelId
        )
      );
      return;
    } else {
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.heating(
          group.ssr.channelId
        )
      );
      return;
    }

    throw new Error(
      'Either no heat controller for this group or cannot execute the requested action'
    );
  }

  async heatSetCooling(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (
      group.heatController &&
      group.heatController.relay &&
      group.generalRelay
    ) {
      group.generalRelay.state = group.heatController.relay_cooling;
      await this.generalRelayUpdateGroup(groupName);

      // We still need to tell the PID that we're cooling down
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.cooling(
          group.ssr.channelId
        )
      );

      return;
    } else {
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.cooling(
          group.ssr.channelId
        )
      );
      return;
    }

    throw new Error(
      'Either no heat controller for this group or cannot execute the requested action'
    );
  }

  heatGetTemperature(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (
      group.heatController &&
      group.heatController.feedbackTemperatureSensor
    ) {
      if (group.heatController.feedbackTemperatureSensor == 'env') {
        return this.groupTemperature[groupName];
      }

      return this.temperatures[groupName][
        group.heatController.feedbackTemperatureSensor
      ].total;
    }

    throw new Error(
      'Either no heat controller for this group or no feedback temperature sensor'
    );
  }

  heatSetPIDParameters(groupName, parameters) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.heatController) {
      group.heatController.pid = {
        kp_cooling: parameters.Kp_c,
        kd_cooling: parameters.Kd_c,
        ki_cooling: parameters.Ki_c,
        bias_cooling: parameters.bias_c,
        kp_heating: parameters.Kp_h,
        kd_heating: parameters.Kd_h,
        ki_heating: parameters.Ki_h,
        bias_heating: parameters.bias_h
      };
    }

    return this.normalizeHeatControllerSSR(groupName);
  }

  heatGetPIDParameters(groupName) {
    const group = this.getGroupFromGroupName(groupName);

    if (!group.heatController || !group.heatController.pid) {
      return {
        heating: {},
        cooling: {}
      };
    }

    return {
      cooling: {
        Kp: group.heatController.pid.kp_cooling,
        Kd: group.heatController.pid.kd_cooling,
        Ki: group.heatController.pid.ki_cooling,
        bias: group.heatController.pid.bias_cooling
      },
      heating: {
        Kp: group.heatController.pid.kp_heating,
        Kd: group.heatController.pid.kd_heating,
        Ki: group.heatController.pid.ki_heating,
        bias: group.heatController.pid.bias_heating
      }
    };
  }

  // So far the only feedback mode is through the SSR controller
  async heaterFeedback(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    //	console.log( this.temperatures[ groupName ], group.heatController.feedbackTemperatureSensor );

    const feedbackTemperature = this.heatGetTemperature(groupName);

    if (!group.heatController) {
      throw new Error(
        `No heat controller for this group (${groupName}), or no temperature sensor`
      );
      return;
    }

    if (group.heatController.mode == 'pid') {
      if (group.heatController.feedbackTemperatureSensor) {
        if (group.heatController.ssr) {
          await this.heaterSSRFeedback(groupName, feedbackTemperature);
        }
      }
      //}
    } else {
      await this.heatSetPower(groupName, group.heatController.power);
    }
  }

  async heatSetMode(groupName, mode) {
    this.getGroupFromGroupName(groupName).heatController.mode = mode;
    this.heaterFeedback(groupName);
  }

  async heatSetPower(groupName, power) {
    const group = this.getGroupFromGroupName(groupName);

    if (group.heatController.mode == 'dcdc_resistor') {
      if (power > 1) {
        power = 1;
      } else if (power < 0) {
        power = 0;
      }

      group.heatController.power = this._dcdcResistorFromPower(
        groupName,
        power
      );

      if (group.heatController.power === undefined) {
        console.warn('No power defined (' + group.heatController.power + ')');
        return;
      }
      group.heatController._power = power;

      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.enable(
          group.heatController.channelId
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.power(
          group.heatController.channelId,
          group.heatController.power
        )
      );
    } else {
      group.heatController.power = power;

      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.enable(
          group.ssr.channelId
        )
      );
      await this.query(
        globalConfig.trackerControllers.specialcommands.heat.power(
          group.ssr.channelId,
          group.heatController.power
        )
      );
    }
  }

  // So far the only feedback mode is through the SSR controller
  async heaterSSRFeedback(groupName, feedbackTemperature) {
    const group = this.getGroupFromGroupName(groupName);
    if (
      group.heatController &&
      group.heatController.feedbackTemperatureSensor &&
      group.heatController.ssr
    ) {
      // SSR:CH1:FEEDBACK 20.5

      if (isNaN(feedbackTemperature)) {
        return await this.query(
          globalConfig.trackerControllers.specialcommands.heat.disable(
            group.ssr.channelId
          )
        );
      } else {
        await this.query(
          globalConfig.trackerControllers.specialcommands.heat.enable(
            group.ssr.channelId
          )
        );
      }

      return await this.query(
        globalConfig.trackerControllers.specialcommands.heat.feedback(
          group.ssr.channelId,
          feedbackTemperature
        )
      );
    }

    throw new Error(
      `No heat controller for this group (${groupName}), or no temperature sensor, or no SSR channel associated`
    );
  }

  async generalRelayUpdate() {
    let groups = this.getInstrumentConfig().groups;
    for (let group of groups) {
      if (!group.generalRelay) {
        continue;
      }
      await this.generalRelayUpdateGroup(groupName);
    }
  }

  async generalRelayUpdateGroup(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.generalRelay) {
      await this.query(
        globalConfig.trackerControllers.specialcommands.relay.general(
          group.generalRelay.channelId,
          group.generalRelay.state
        )
      );
    }
  }

  async autoZero(chanId) {
    await this.query(
      globalConfig.trackerControllers.specialcommands.autoZero(chanId)
    );
  }

  async heaterGetVoltage(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.heatController.mode == 'dcdc_resistor') {
      return this._dcdcCommand(groupName, 'getVoltage', undefined, true).then(
        val => parseFloat(val)
      );
    }
  }

  async heaterGetCurrent(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    if (group.heatController.mode == 'dcdc_resistor') {
      return this._dcdcCommand(groupName, 'getCurrent', undefined, true).then(
        val => parseFloat(val)
      );
    }
  }

  async normalizeHeatControllerDCDC(groupName, force) {
    const group = this.getGroupFromGroupName(groupName);

    if (!isNaN(group.heatController._power)) {
      this.heatSetPower(groupName, group.heatController._power);
    }
  }

  _dcdcResistorFromPower(groupName, power) {
    const group = this.getGroupFromGroupName(groupName);

    if (isNaN(power)) {
      return;
    }

    if (power > 1) {
      power = 1;
    }

    if (power < 0) {
      power = 0;
    }

    let setVoltage = power * group.heatController.maxVoltage;
    if (setVoltage < 1) {
      setVoltage = 1;
    }

    let rbottom = (0.75 * 82000) / (setVoltage - 0.75);
    rbottom = 50000 - rbottom;
    let rbottomcode = Math.round((rbottom / 50000) * 256);

    if (rbottomcode < 0) {
      rbottomcode = 0;
    } else if (rbottomcode > 255) {
      rbottomcode = 255;
    }

    if (isNaN(rbottomcode)) {
      return;
    }

    return rbottomcode;
  }

  async heatIncreasePower(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    return this.heatSetPower(
      groupName,
      (group.heatController._power || 0) + 0.05
    );
  }

  async heatDecreasePower(groupName) {
    const group = this.getGroupFromGroupName(groupName);
    return this.heatSetPower(
      groupName,
      (group.heatController._power || 0) - 0.05
    );
  }

  async _dcdcCommand(groupName, command, value, request) {
    const group = this.getGroupFromGroupName(groupName);

    if (!groupName) {
      throw new Error(`No light configuration for the group ${groupName}`);
    }

    if (group.heatController.channelId) {
      return this.query(
        globalConfig.trackerControllers.specialcommands.dcdc[command](
          group.heatController.channelId,
          value
        ),
        request ? 2 : 1
      );
    }

    throw new Error(
      `No light channel was defined for the group ${groupName}. Check that the option "channelId" is set and different from null or 0.`
    );
  }
}

/*



function openConnections() {

	return globalConfig.trackerControllers.instruments.map( ( instrumentConfig ) => {


	} );
}


async function requestTemperature( instrumentId, channelId ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;
		return comm.lease = query( instrumentId, "DATA:TEMPERATURE:CH" + instrumentId );
	} );
}



async function requestHumidity( instrumentId ) {

	let comm = connections[ instrumentId ];

	if( ! comm ) {
		rejecter("Cannot find communication stream with the instrument based on the instrument id");
	}

	return comm.queryManager.addQuery( async ( ) => {

		await comm.lease;
		return comm.lease = query( instrumentId, "DATA:HUMIDITY" );
	} );
}*/

function possibleNewMeasurement(measurementName, status, group, chanId) {
  let trackingMode;
  switch (status.tracking_mode) {
    case 1:
      trackingMode = 'MPP';
      break;

    case 2:
      trackingMode = 'JSC';
      break;

    case 3:
      trackingMode = 'VOC';
      break;

    case 4:
      trackingMode = 'CONSTV';
      break;
  }

  const trackingLight = group.light ? !!group.light.channelId : false;
  const trackingHumidity = !!group.humiditySensor;
  let trackingTemperature = false;

  if (group.temperatureSensors) {
    group.temperatureSensors.map(temp => {
      if (temp.channels.indexOf(chanId) > -1) {
        trackingTemperature = true;
      }
    });
  }

  if (!measurements[measurementName]) {
    measurements[measurementName] = {
      cellInfo: {
        cellName: status.cellName,
        cellArea: status.cellArea,

        trackingMode: trackingMode,
        lightMonitoring: trackingLight,
        temperatureMonitoring: trackingTemperature,
        humidityMonitoring: trackingHumidity
      },
      startDate: Date.now()
    };

    fs.writeFileSync(
      './trackercontroller/measurements.json',
      JSON.stringify(measurements, undefined, '\t')
    );
    return Date.now();
  }

  return -1;
}

function measurementEnd(measurementName) {
  if (measurements[measurementName]) {
    measurements[measurementName].endDate = Date.now();
    fs.writeFileSync(
      './trackercontroller/measurements.json',
      JSON.stringify(measurements, undefined, '\t')
    );
  }
}

/**
 *	Verifies if a collection of objects has changed between two states
 *	@param { Array } objectCollection - An iterable object describing the elements to check
 *	@param { Object } ...states - A list of states objects which key may include the items in objectCollection
 *	@return { Boolean } - true if the state has changed, false otherwise
 */
function _hasChanged(objectCollection, ...states) {
  var changed = false;
  objectCollection.forEach(el => {
    let stateRef;
    states.forEach((state, index) => {
      if (index == 0) {
        stateRef = state[el];
      } else {
        if (
          stateRef === undefined ||
          state[el] === undefined ||
          stateRef !== state[el]
        ) {
          changed = true;
        }
      }
    });
  });

  return changed;
}

function delay(time) {
  return new Promise(resolver =>
    setTimeout(() => {
      resolver();
    }, time)
  );
}

module.exports = TrackerController;
