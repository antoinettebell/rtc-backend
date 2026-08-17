const assert = require('assert');
const {
  isMarketplaceLocationUnlocked,
  isMarketplaceDetailsUnlocked,
  isEventVendorApplicationUnlocked,
} = require('./marketplace-vendor-access-policy');

assert.equal(
  isMarketplaceLocationUnlocked({ bid: { bid_status: 'AWARDED' } }),
  true
);
assert.equal(
  isMarketplaceLocationUnlocked({
    application: { application_status: 'PAYMENT_DUE' },
    vendorPaymentSatisfied: false,
  }),
  false
);
assert.equal(
  isMarketplaceLocationUnlocked({
    application: { application_status: 'PAID' },
    vendorPaymentSatisfied: true,
  }),
  true
);
assert.equal(
  isMarketplaceDetailsUnlocked({
    matchSatisfied: false,
    scenario: 'VENDOR_PAYS',
    coordinatorPaymentSatisfied: true,
    vendorPaymentSatisfied: true,
  }),
  false
);
assert.equal(
  isMarketplaceDetailsUnlocked({
    matchSatisfied: true,
    scenario: 'COORDINATOR_PAYS',
    coordinatorPaymentSatisfied: false,
    vendorPaymentSatisfied: true,
  }),
  false
);
assert.equal(
  isMarketplaceDetailsUnlocked({
    matchSatisfied: true,
    scenario: 'BOTH',
    coordinatorPaymentSatisfied: true,
    vendorPaymentSatisfied: true,
  }),
  true
);
assert.equal(
  isEventVendorApplicationUnlocked({ status: 'PAYMENT_DUE', checkout_subtotal: 0.01 }),
  false
);
assert.equal(
  isEventVendorApplicationUnlocked({ status: 'PAID', checkout_subtotal: 0.01 }),
  true
);
assert.equal(
  isEventVendorApplicationUnlocked({ status: 'AWARDED', checkout_subtotal: 0 }),
  true
);
assert.equal(
  isEventVendorApplicationUnlocked({ status: 'AWARDED' }),
  false
);
assert.equal(
  isEventVendorApplicationUnlocked({ status: 'SUBMITTED', checkout_subtotal: 0 }),
  false
);

console.log('marketplace vendor access policy tests passed');
