#!/usr/bin/env node
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const coll = process.argv[2];

const uri = `mongodb://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;

(async () => {
  try {
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    if (!coll) {
      const cols = await db.listCollections().toArray();
      console.log(JSON.stringify(cols.map(c=>c.name)));
    } else {
      const doc = await db.collection(coll).findOne({}, { projection: { bank_account: 1, _id: 0 }});
      console.log(JSON.stringify(doc));
    }
    await mongoose.disconnect();
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(2);
  }
})();
