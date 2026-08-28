const assert = require('assert');
const {
  getApplePayCheckoutRequestShape,
  isApplePayCheckout,
} = require('./apple-pay-checkout-diagnostics');

const rawToken = 'sensitive-apple-pay-token';
const shape = getApplePayCheckoutRequestShape({
  paymentData: rawToken,
  paymentMethod: 'APPLE_PAY',
  amount: '1.00',
});

assert.deepStrictEqual(shape.field_names, ['amount', 'paymentData', 'paymentMethod']);
assert.deepStrictEqual(shape.payment_data, { type: 'string', present: true });
assert.deepStrictEqual(shape.amount, { type: 'string', present: true });
assert.strictEqual(JSON.stringify(shape).includes(rawToken), false);
assert.strictEqual(isApplePayCheckout({ paymentMethod: 'APPLE_PAY' }), true);
assert.strictEqual(isApplePayCheckout({ paymentMethod: 'GOOGLE_PAY' }), false);

console.log('apple-pay checkout diagnostics tests passed');
