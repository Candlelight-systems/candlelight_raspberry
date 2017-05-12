
const Influx = require("influx");
const config = require('../config');

const influxClient = new Influx.InfluxDB({
  host: config.influx.host,
  username: config.influx.username,
  password: config.influx.password,
  database: config.influx.db
});

module.exports = {};

module.exports.storeIV = function( measurementName, ivData ) {
	// Use SQLite ?
  return influxClient.writePoints([
      {
        measurement: measurementName + "_iv",
        fields: { 
          iv: '"' + ivData + '"'
        }
      }

    ]).then( ( result ) => {
      
      return result; 

    }).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}

module.exports.storeTrack = function( measurementName, trackData ) {

    return influxClient.writePoints([
      {
        measurement: measurementName,
        fields: { 
          voltageMin: trackData.voltageMin,
          voltageMean: trackData.voltageMean,
          voltageMax: trackData.voltageMax,
          currentMin: trackData.currentMin,
          currentMean: trackData.currentMean,
          currentMax: trackData.currentMax,
          powerMin: trackData.powerMin,
          powerMean: trackData.powerMean,
          powerMax: trackData.powerMax,
          efficiency: trackData.efficiency,
          sun: trackData.sun
        },
      }

    ]).then( ( result ) => {
      
      return result; 

    }).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}


module.exports.storeVoc = function( measurementName, voc ) {

    return influxClient.writePoints([
      {
        measurement: measurementName + "_voc",
        fields: { 
          voc: voc
        }
      }

    ]).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}


module.exports.storeJsc = function( measurementName, jsc ) {

    return influxClient.writePoints([
      {
        measurement: measurementName + "_jsc",
        fields: { 
          jsc: jsc
        },
      }

    ]).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}