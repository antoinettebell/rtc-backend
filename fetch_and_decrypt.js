#!/usr/bin/env node
require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const cryptLib = require('cryptlib');
const host = process.env.DB_HOST||'';
const port = process.env.DB_PORT||'';
const user = process.env.DB_USER||'';
const pass = process.env.DB_PASS||'';
const db = process.env.DB_NAME||'';
function buildUri() {
  if (host && host.includes('mongodb.net') && (!port || port === '')) {
    return `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${db}`;
  } else {
    return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}${port?':'+port:''}/${db}`;
  }
}
(async () => {
  try {
    const uri = buildUri();
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    const c = mongoose.connection.db.collection('bank-details');
    const doc = await c.findOne({});
    if (!doc) {
      console.error('NO_DOC_FOUND'); process.exit(0);
    }
    const secret = process.env.ENCRYPTION_SECRET_KEY || '';
    if (!secret) {
      console.error('MISSING_ENCRYPTION_SECRET_KEY'); process.exit(2);
    }
    const key = cryptLib.getHashSha256(secret, 32);
    const fields = ['accountHolderName','accountNumber','accountType','bankName','iban','paymentMethod','remittanceEmail','routingNumber','swiftCode','currency'];
    const out = {};
    fields.forEach(name => {
      const v = doc[name];
      if (!v) { out[name]=null; return; }
      if (typeof v === 'string' && v.includes(':')) {
        try {
          const parts = v.split(':'); const iv = parts.shift(); const cipher = parts.join(':');
          out[name] = cryptLib.decrypt(cipher, key, iv);
        } catch (e) { out[name] = `DECRYPT_ERROR: ${e.message||e}`; }
      } else { out[name] = v; }
    });
    console.log(JSON.stringify({ _id: doc._id, decrypted: out }, null, 2));
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('ERROR', err.message || err); process.exit(2);
  }
})();
