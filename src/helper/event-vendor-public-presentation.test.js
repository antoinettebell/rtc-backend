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
for (const field of [
  'event_description', 'event_date', 'event_start_time', 'event_address',
  'expected_ga_guests', 'payment_responsibility',
  'last_date_to_accept_payments', 'event_vendor_needs', 'public_images',
]) assert.match(eligible, new RegExp(field));
for (const privateField of [
  'tax_exemption_certificate', 'eventCoordinatorPaymentQrCodeUrl',
  'agreement_document', 'routing_number',
]) assert.doesNotMatch(eligible, new RegExp(privateField));
assert.match(source, /suspend: async \(\) => false/);
assert.match(source, /Photo uploaded and saved to repository'/);
console.log('Marketplace Vendor public presentation tests passed');
