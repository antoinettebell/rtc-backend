const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '../v1/controllers/event-vendor-controller.js'),
  'utf8'
);
const eligible = source.slice(
  source.indexOf('exports.eligibleEvents'),
  source.indexOf('exports.submitApplication')
);
const allowlist = source.slice(
  source.indexOf('const EVENT_VENDOR_PUBLIC_EVENT_FIELDS'),
  source.indexOf('const error =')
);
for (const field of [
  'event_description', 'event_date', 'event_start_time', 'event_address',
  'expected_ga_guests', 'payment_responsibility',
  'last_date_to_accept_payments', 'event_vendor_needs',
]) assert.match(allowlist, new RegExp(field));
assert.match(eligible, /public_images/);
for (const privateField of [
  'tax_exemption_certificate', 'eventCoordinatorPaymentQrCodeUrl',
  'agreement_document', 'routing_number',
]) assert.doesNotMatch(allowlist, new RegExp(privateField));
assert.match(source, /suspend: async \(\) => false/);
assert.match(source, /Photo uploaded and saved to repository'/);
console.log('Marketplace Vendor public presentation tests passed');
