const assert = require('assert');
const {
  calculateRuleBasedBogoPricing,
  roundCurrency,
} = require('./order-bogo-pricing-helper');

const result = calculateRuleBasedBogoPricing({
  primaryUnitPrice: 0.26,
  quantity: 1,
  rewardBasePrice: 0.01,
  rewardOptionsCost: 0.5,
  discountRules: { buyQty: 1, getQty: 1, discount: 0.5, repeatable: true },
});

assert.strictEqual(result.rewardQuantity, 1);
assert.strictEqual(roundCurrency(result.totalBeforeRounding), 0.77);
assert.strictEqual(roundCurrency(0.455), 0.46);
assert.strictEqual(roundCurrency(0.655), 0.66);

console.log('BOGO pricing and currency rounding tests passed');
