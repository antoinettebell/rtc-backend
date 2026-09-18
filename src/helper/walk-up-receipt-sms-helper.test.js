const assert = require('assert');
const {
  buildTapToPayReceiptSmsBody,
} = require('./walk-up-receipt-sms-helper');

const body = buildTapToPayReceiptSmsBody({
  order: {
    orderNumber: 42,
    subTotal: 10,
    taxAmount: 0.8,
    paymentProcessingFee: 0.38,
    tipsAmount: 2,
    totalOrderCost: 13.18,
  },
  foodTruck: { name: 'Test Kitchen' },
});

assert.strictEqual(
  body,
  'RDC receipt: Tap to Pay approved for order #42 from Test Kitchen. Items $10.00, tax $0.80, processing fee $0.38, tip $2.00, total $13.18. Reply STOP to opt out.'
);
assert.doesNotMatch(body, /transaction|account|card/i);

console.log('walk-up receipt SMS helper tests passed');
