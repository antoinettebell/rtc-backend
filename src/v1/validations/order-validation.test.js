const test = require('node:test');
const assert = require('node:assert/strict');

const orderValidation = require('./order-validation');

test('PREPARING order updates require the calculated preparation minutes', async () => {
  const value = await orderValidation.update.body.validateAsync({
    orderStatus: 'PREPARING',
    pickupTime: '20',
  });

  assert.equal(value.pickupTime, '20');
  await assert.rejects(
    orderValidation.update.body.validateAsync({ orderStatus: 'PREPARING' }),
    /pickupTime/
  );
});

const validOrder = {
  foodTruckId: 'food-truck-1',
  locationId: 'location-1',
  paymentStatus: 'PAID',
  transactionId: 'tap-transaction-1',
  items: [{ menuItemId: 'menu-item-1', qty: 1 }],
};

test('Tap to Pay orders accept the provider transaction ID without an auth code', async () => {
  const value = await orderValidation.add.body.validateAsync({
    ...validOrder,
    paymentMethod: 'TAP_TO_PAY',
    tapToPayAttemptId: 'attempt-1',
  });

  assert.equal(value.transactionId, 'tap-transaction-1');
  assert.equal(value.authCode, undefined);
});

test('wallet orders still require their processor auth code', async () => {
  await assert.rejects(
    orderValidation.add.body.validateAsync({
      ...validOrder,
      paymentMethod: 'APPLE_PAY',
    }),
    /authCode/
  );
});
