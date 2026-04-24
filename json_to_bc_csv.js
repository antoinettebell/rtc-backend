#!/usr/bin/env node
const fs = require('fs');
const inFile = process.argv[2] || '/tmp/bank_details_plain.json';
const outFile = process.argv[3] || '/tmp/bank_details_bc.csv';
if (!fs.existsSync(inFile)) { console.error('INPUT_MISSING', inFile); process.exit(1); }
const raw = fs.readFileSync(inFile,'utf8').trim();
let obj; try { obj = JSON.parse(raw); } catch(e) { console.error('JSON_PARSE_ERROR', e.message); process.exit(1); }
let records = [];
if (Array.isArray(obj)) records = obj;
else if (obj && obj.decrypted) records = [{ _id: obj._id, ...obj.decrypted }];
else records = [obj];
const headers = ['VendorNo','VendorExternalId','AccountHolderName','BankAccountNumber','AccountType','BankName','IBAN','RoutingNumber','SWIFTCode','Currency','PaymentMethod','RemittanceEmail','Notes'];
function getVal(r,k){ return (r[k]===null||typeof r[k]==='undefined')?'':String(r[k]).replace(/\r?\n/g,' '); }
const lines=[headers.join(',')];
for(const r of records){
  const row = [
    getVal(r,'VendorNo')||'',
    getVal(r,'userId')||getVal(r,'vendorId')||getVal(r,'VendorExternalId')||'',
    getVal(r,'accountHolderName'),
    getVal(r,'accountNumber'),
    getVal(r,'accountType'),
    getVal(r,'bankName'),
    getVal(r,'iban'),
    getVal(r,'routingNumber'),
    getVal(r,'swiftCode'),
    getVal(r,'currency'),
    getVal(r,'paymentMethod'),
    getVal(r,'remittanceEmail'),
    ''
  ];
  lines.push(row.map(v => v.includes(',')||v.includes('"')?`"${v.replace(/"/g,'""')}"`:v).join(','));
}
fs.writeFileSync(outFile, lines.join('\n'));
console.log('WROTE', outFile, 'ROWS=', records.length);
