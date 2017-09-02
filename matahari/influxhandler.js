
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
          voltage_min: trackData.voltageMin,
          voltage_mean: trackData.voltageMean,
          voltage_max: trackData.voltageMax,
          current_min: trackData.currentMin,
          current_mean: trackData.currentMean,
          current_max: trackData.currentMax,
          power_min: trackData.powerMin,
          power_mean: trackData.powerMean,
          power_max: trackData.powerMax,
          efficiency: trackData.efficiency,
          sun: trackData.sun,
          pga: trackData.pga
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

    return influxClient.writePoints( [
      {
        measurement: measurementName + "_jsc",
        fields: { 
          jsc: jsc
        },
      }

    ] ).catch( ( err ) => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}



module.exports.storeEnvironment = function( measurementName, temperature, humidity, lights ) {

  let fields = { 
    temperature: temperature,
    humidity: humidity
  };

  lights.forEach( ( val, index ) => {
    fields[ "light" + ( index + 1 ) ] = val;
  });


    return influxClient.writePoints( [
      {
        measurement: measurementName,
        fields: fields
      }

    ] ).catch( ( err ) => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}