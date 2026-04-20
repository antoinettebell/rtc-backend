/**
 * Mongoose connection file
 */
const mongoose = require('mongoose');
const { mongo } = require('../config');
const Bootstrap = require('../helper/bootstrap');

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
  .connect(connectionURL)
  .then(() => {
    console.log('Database connected');
    Bootstrap.init();
  })
  .catch((e) => {
    console.log('Database error', e);
  });
