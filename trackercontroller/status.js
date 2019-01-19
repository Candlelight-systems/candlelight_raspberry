const path = require('path');

const statusPath = path.join(__dirname, './status.json');
if (!fs.existsSync(statusPath)) {
  fs.writeFileSync(statusPath, JSON.stringify({ channels: [] }));
}

let statusGlobal;
try {
  statusGlobal = require('./status.json');
} catch (e) {
  statusGlobal = { channels: [] };
}

module.exports = {
  getChannels: () => {
    if (!statusGlobal.channels) {
      statusGlobal.channels = {};
    }

    return statusGlobal.channels;
  },

  getStatus: () => {
    return statusGlobal;
  },

  save: () => {
    return fs.writeFileSync(
      statusPath,
      JSON.stringify(statusGlobal, undefined, '\t')
    );
  }
};
