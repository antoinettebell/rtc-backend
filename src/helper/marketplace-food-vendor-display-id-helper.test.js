const assert = require('assert');
const {
  getFoodVendorDisplayId,
  getFoodVendorDisplayIdsByProfileId,
} = require('./marketplace-food-vendor-display-id-helper');

const firstProfileId = '268bfebc-ea56-425c-bf89-5a46cd70c80b';
const secondProfileId = '0fc85ee1-5e5a-4d42-9806-04c2a279f944';
const displayIds = getFoodVendorDisplayIdsByProfileId([
  { _id: firstProfileId },
  { _id: secondProfileId },
]);

assert.strictEqual(displayIds.get(firstProfileId), 'Vendor RTC - 70C80B');
assert.strictEqual(displayIds.get(secondProfileId), 'Vendor RTC - 79F944');
assert.ok(!displayIds.get(firstProfileId).includes(firstProfileId));
assert.ok(!displayIds.get(secondProfileId).includes(secondProfileId));
assert.notStrictEqual(
  displayIds.get(firstProfileId),
  getFoodVendorDisplayId('bid-000000'),
  'a bid identifier must not determine the Food Vendor support code'
);
assert.notStrictEqual(
  displayIds.get(secondProfileId),
  getFoodVendorDisplayId('application-000000'),
  'an application identifier must not determine the Food Vendor support code'
);
assert.strictEqual(
  displayIds.get(firstProfileId),
  getFoodVendorDisplayId(firstProfileId),
  'the same canonical profile ID remains stable across refresh, close, and reopen'
);

console.log('marketplace Food Vendor display ID tests passed');
