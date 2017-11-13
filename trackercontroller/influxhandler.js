
const Influx = require("influx");
const config = require('../config/influx.json');
console.log( config );

const influxClient = new Influx.InfluxDB({
  host: config.host,
  username: config.username,
  password: config.password,
  database: config.db
});



module.exports = {};

module.exports.storeIV = function( measurementName, ivData, sun ) {
	// Use SQLite ?
  return influxClient.writePoints([
      {
        measurement: measurementName + "_iv",
        fields: { 
          iv: '"' + ivData + '"',
          sun: sun
        }
      }

    ]).then( ( result ) => {
      
      return result; 

    }).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}

module.exports.saveTrackData = function( trackData ) {

  
    return influxClient.writePoints( trackData ).then( ( result ) => {
      
      return result; 

    }).catch(err => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}


module.exports.storeVoc = function( measurementName, voc ) {

    return influxClient.writePoints([
      {
        measurement: encodeURIComponent( measurementName ) + "_voc",
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
        measurement: encodeURIComponent( measurementName ) + "_jsc",
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
        measurement: encodeURIComponent( measurementName ),
        fields: fields
      }

    ] ).catch( ( err ) => {

      console.error( `Error saving data to InfluxDB! ${err.stack}` );
    });
}