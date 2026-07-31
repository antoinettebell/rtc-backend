const assert = require('assert');
const {
  buildRefundSmsBody,
  getRefundAmountExcludingTip,
} = require('./walk-up-refund-sms-helper');

assert.strictEqual(
  getRefundAmountExcludingTip({ total: 4.26, tipsAmount: 0.25 }),
  4.01
);
assert.strictEqual(
  buildRefundSmsBody({ order: { orderNumber: 123 }, amount: 4.01 }),
  'RTC: Refunded order #123. Refund amount: $4.01. Tips are not refunded.'
);

console.log('walk-up refund SMS helper tests passed');
