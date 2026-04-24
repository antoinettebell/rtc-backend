require('dotenv').config({path:'./.env'});
const mongoose = require('mongoose');
(async ()=>{
  const host = process.env.DB_HOST||'';
  const port = process.env.DB_PORT||'';
  const user = process.env.DB_USER||'';
  const pass = process.env.DB_PASS||'';
  const db = process.env.DB_NAME||'';
  const uri = (host && host.includes('mongodb.net') && (!port||port==='')) ?
    `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}/${db}` :
    `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}${port?':'+port:''}/${db}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  const doc = await mongoose.connection.db.collection('bank-details').findOne({}, {
    projection:{ accountHolderName:1, accountNumber:1, accountType:1, bankName:1, iban:1, paymentMethod:1, remittanceEmail:1, routingNumber:1, swiftCode:1, _id:0 }
  });
  console.log(JSON.stringify(doc || {}));
  await mongoose.disconnect();
  process.exit(0);
})().catch(e=>{ console.error('ERROR', e.message||e); process.exit(2);});
