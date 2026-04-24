#!/usr/bin/env node
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const coll = process.argv[2];

const host = process.env.DB_HOST || '';
const port = process.env.DB_PORT || '';
const user = process.env.DB_USER || '';
const pass = process.env.DB_PASS || '';
const db = process.env.DB_NAME || '';

function buildUri() {
  if (host && host.includes('mongodb.net') && (!port || port === '')) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${db}`;
  } else {
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}${port ? ':'+port : ''}/${db}`;
  }
}

(async () => {
  try {
    const uri = buildUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    const dbconn = mongoose.connection.db;
    if (!coll) {
      const cols = await dbconn.listCollections().toArray();
      console.log(JSON.stringify(cols.map(c => c.name)));
    } else {
      const doc = await dbconn.collection(coll).findOne({}, { projection: { bank_account: 1, _id: 0 }});
      console.log(JSON.stringify(doc));
    }
    await mongoose.disconnect();
  } catch (e) {
    console.error('ERROR', e.message || e);
    process.exit(2);
  }
})();
