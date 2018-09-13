
const Influx          = require("influx");
const config          = require("../config").influx;


let influxClient = new Influx.InfluxDB({
  host: config.host,
  username: config.username,
  password: config.password,
  database: config.db
});



module.exports = {};

module.exports.changed = () => {

  // Overwrite the previous value
  influxClient = new Influx.InfluxDB({
    host: config.host,
    username: config.username,
    password: config.password,
    database: config.db
  });
}

module.exports.storeIV = function( measurementName, ivData, sun ) {
	// Use SQLite ?

    return influxClient.writePoints([
        {
          measurement: encodeURIComponent( measurementName ) + "_iv",
          timestamp: Date.now() * 1000000, // nano seconds
          fields: { 
            iv: '"' + ivData + '"',
            sun: sun
          }
        }

      ]);

}

module.exports.saveTrackData = function( trackData ) {

    
    return influxClient.writePoints( trackData ).then( ( result ) => {
      
      return result; 

    });
}


module.exports.storeVoc = function( measurementName, voc ) {

    return influxClient.writePoints([
      {
        measurement: encodeURIComponent( measurementName ) + "_voc",
        timestamp: Date.now() * 1000000, // nano seconds
        fields: { 
          voc: voc
        }
      }

    ]);
}


module.exports.storeJsc = function( measurementName, jsc ) {

    return influxClient.writePoints( [
      {
        measurement: encodeURIComponent( measurementName ) + "_jsc",
        timestamp: Date.now() * 1000000, // nano seconds
        fields: { 
          jsc: jsc
        }
      }

    ] );
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
      timestamp: Date.now() * 1000000, // nano seconds
      fields: fields
    }

  ] );
}