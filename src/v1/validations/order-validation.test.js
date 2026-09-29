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
