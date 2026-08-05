const assert = require('assert');
const {
  isMarketplacePaymentMethodAllowed,
} = require('./marketplace-payment-policy-helper');
const MarketplacePaymentModel = require('../models/marketplace-payment');

const allowed = (userType, paymentMethod, paymentType = 'FINAL_EVENT_PAYMENT') =>
  isMarketplacePaymentMethodAllowed({ paymentType, userType, paymentMethod });

assert.strictEqual(allowed('CUSTOMER', 'APPLE_PAY'), true);
assert.strictEqual(allowed('CUSTOMER', 'GOOGLE_PAY'), true);
assert.strictEqual(allowed('CUSTOMER', 'CASH'), false);
assert.strictEqual(allowed('CUSTOMER', 'TAP_TO_PAY'), false);
assert.strictEqual(allowed('VENDOR', 'CASH'), true);
assert.strictEqual(allowed('VENDOR', 'TAP_TO_PAY'), true);
assert.strictEqual(allowed('VENDOR', 'APPLE_PAY'), false);
assert.strictEqual(allowed('VENDOR', 'GOOGLE_PAY'), false);
assert.strictEqual(allowed('VENDOR', 'CASH', 'VENDOR_EVENT_FEE'), false);
assert.strictEqual(allowed('VENDOR', 'APPLE_PAY', 'VENDOR_EVENT_FEE'), true);

const paymentMethodValues = MarketplacePaymentModel.schema.path('payment_method').enumValues;
const paymentStatusValues = MarketplacePaymentModel.schema.path('payment_status').enumValues;
assert(paymentMethodValues.includes('CASH'));
assert(paymentStatusValues.includes('PROCESSING'));
assert(
  MarketplacePaymentModel.schema.indexes().some(
    ([fields, options]) =>
      fields.event_id === 1 &&
      fields.bid_id === 1 &&
      fields.payment_type === 1 &&
      options.unique === true
  )
);

console.log('marketplace payment policy helper tests passed');
