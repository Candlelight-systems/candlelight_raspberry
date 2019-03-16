let measurements;

const measurementsPath = path.join(__dirname, './measurements.json');

if (!fs.existsSync(measurementsPath)) {
  fs.writeFileSync(measurementsPath, JSON.stringify({}));
}

try {
  measurements = require('./measurements.json');
} catch (e) {
  fs.writeFileSync(measurementsPath, JSON.stringify({}));
  measurements = {};
}

return measurements;
