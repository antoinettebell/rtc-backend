/**
 * Mongoose connection file
 */
const mongoose = require('mongoose');
const { mongo } = require('../config');
const Bootstrap = require('../helper/bootstrap');
const VendorComplianceService = require('../v1/services/vendor-compliance-service');

const COMPLIANCE_MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const startComplianceMaintenance = () => {
  if (String(process.env.COMPLIANCE_MAINTENANCE_ENABLED || 'true') === 'false') {
    return;
  }

  const run = async () => {
    try {
      await VendorComplianceService.runComplianceMaintenance();
    } catch (error) {
      console.error('Compliance maintenance failed', error);
    }
  };

  setTimeout(run, 60 * 1000);
  setInterval(run, COMPLIANCE_MAINTENANCE_INTERVAL_MS);
};

let connectionURL = `mongodb://${mongo.dbHost}:${mongo.dbPort}/${mongo.dbName}`;

/** If it is require password to connect */
if (mongo.dbUser && mongo.dbPass) {
  connectionURL = `mongodb://${mongo.dbUser}:${mongo.dbPass}@${mongo.dbHost}:${mongo.dbPort}/${mongo.dbName}?authSource=admin`;

  if (!mongo.dbPort) {
    // it means SRV
    connectionURL = `mongodb+srv://${mongo.dbUser}:${mongo.dbPass}@${mongo.dbHost}/${mongo.dbName}?authSource=admin`;
  }
}

/** Main connection */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('Database connected');
    Bootstrap.init();
    startComplianceMaintenance();
  })
  .catch((e) => {
    console.log('Database error', e);
  });
