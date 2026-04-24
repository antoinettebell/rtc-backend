#!/usr/bin/env node
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const coll = process.argv[2] || '';
const host = process.env.DB_HOST || '';
const port = process.env.DB_PORT || '';
const user = process.env.DB_USER || '';
const db = process.env.DB_NAME || '';

function maskedUri() {
  if (host.includes('mongodb.net') && (!port || port === '')) {
    return `mongodb+srv://${encodeURIComponent(user)}:*****@${host}/${db}`;
  } else {
    return `mongodb://${encodeURIComponent(user)}:*****@${host}${port ? ':'+port : ''}/${db}`;
  }
}

(async () => {
  try {
    const rawUri = (host.includes('mongodb.net') && (!port || port === ''))
      ? `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(process.env.DB_PASS || '')}@${host}/${db}`
      : `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(process.env.DB_PASS || '')}@${host}${port ? ':'+port : ''}/${db}`;

    console.log('USING_URI_MASKED:', maskedUri());
    console.log('ATTEMPTING_CONNECT (timeout 20s) ...');
    await mongoose.connect(rawUri, { serverSelectionTimeoutMS: 20000 });
    const dbconn = mongoose.connection.db;
    if (!coll) {
      const cols = await dbconn.listCollections().toArray();
      console.log('COLLECTIONS:', JSON.stringify(cols.map(c => c.name)));
    } else {
      const doc = await dbconn.collection(coll).findOne({}, { projection: { bank_account: 1, _id: 0 }});
      console.log('DOC:', JSON.stringify(doc));
    }
    await mongoose.disconnect();
  } catch (e) {
    console.error('CONNECT_ERROR:', e.stack || e.message || e);
    process.exit(2);
  }
})();
