#!/usr/bin/env node
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const coll = process.argv[2] || 'bank-details';
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

    const cols = await dbconn.listCollections().toArray();
    console.log('COLLECTIONS:', JSON.stringify(cols.map(c => c.name)));

    const c = dbconn.collection(coll);
    const count = await c.countDocuments();
    console.log('COUNT:', count);

    if (count > 0) {
      const doc = await c.findOne({});
      console.log('FIRST_DOC_FULL:', JSON.stringify(doc, null, 2));
    } else {
      console.log('FIRST_DOC_FULL: {}');
    }

    await mongoose.disconnect();
  } catch (e) {
    console.error('CONNECT_ERROR:', e.stack || e.message || e);
    process.exit(2);
  }
})();
