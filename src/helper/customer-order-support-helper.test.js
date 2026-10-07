const assert = require('assert');
const {
  SUPPORT_PHONE_NUMBER,
  getRefundDecision,
  isWithinRefundRequestWindow,
  buildSupportSmsBody,
} = require('./customer-order-support-helper');

assert.deepStrictEqual(getRefundDecision(0), {
  outcome: 'AUTO_REFUND',
  percentage: 100,
  message: 'A full refund will be issued to your original payment method.',
});
assert.deepStrictEqual(getRefundDecision(1), {
  outcome: 'AUTO_REFUND',
  percentage: 50,
  message: 'A 50% refund will be issued to your original payment method.',
});
assert.deepStrictEqual(getRefundDecision(2), {
  outcome: 'ESCALATED',
  percentage: 0,
  message: 'Support will be in touch to help with this order.',
});
assert.strictEqual(getRefundDecision(8).outcome, 'ESCALATED');
assert.strictEqual(SUPPORT_PHONE_NUMBER, '803-844-7600');
const now = new Date('2026-10-07T14:00:00.000Z');
assert.strictEqual(
  isWithinRefundRequestWindow(
    { fulfillmentType: 'DELIVERY', statusTime: { deliveredAt: '2026-10-07T12:01:00.000Z' } },
    now
  ),
  true
);
assert.strictEqual(
  isWithinRefundRequestWindow(
    { fulfillmentType: 'PICKUP', completed_at: '2026-10-07T11:59:59.000Z' },
    now
  ),
  false
);
assert.strictEqual(isWithinRefundRequestWindow({ fulfillmentType: 'DELIVERY' }, now), false);

const sms = buildSupportSmsBody({
  order: { _id: 'order-id', orderNumber: 42, foodTruckName: 'Truck' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '8035551212' },
  issueType: 'OTHER',
  outcome: 'ESCALATED',
});
assert.match(sms, /Order #42/);
assert.match(sms, /Ada Lovelace/);
assert.doesNotMatch(sms, /transaction|paymentData|token/i);

console.log('customer-order-support-helper tests passed');
