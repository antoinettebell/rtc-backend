const assert = require('assert');
const { getFoodVendorAwardCapacity } = require('./marketplace-award-batch');

assert.deepEqual(
  (({ limit, awarded, remaining }) => ({ limit, awarded, remaining }))(
    getFoodVendorAwardCapacity({ event: { number_of_vendors_needed: 2 } })
  ),
  { limit: 2, awarded: 0, remaining: 2 }
);

const capacity = getFoodVendorAwardCapacity({
  event: { number_of_vendors_needed: 2 },
  bids: [{ bid_status: 'AWARDED', vendor_user_id: 'vendor-1', archived_at: null }],
  applications: [
    { application_status: 'PAYMENT_DUE', vendor_user_id: 'vendor-1', archived_at: null },
    { application_status: 'SUBMITTED', vendor_user_id: 'vendor-2', archived_at: null },
  ],
});
assert.equal(capacity.awarded, 1, 'a linked bid/application vendor counts once');
assert.equal(capacity.remaining, 1);

assert.equal(getFoodVendorAwardCapacity({
  event: { number_of_vendors_needed: 2 },
  bids: [
    { bid_status: 'AWARDED', vendor_user_id: 'vendor-1', archived_at: null },
    { bid_status: 'AWARDED', vendor_user_id: 'vendor-2', archived_at: null },
  ],
}).remaining, 0);

console.log('marketplace incremental award capacity tests passed');
