const assert = require('assert');
const {
  getComboSubItemId,
  hasActiveBogoPromotion,
} = require('./combo-promotion-helper');

assert.strictEqual(
  hasActiveBogoPromotion({ hasDiscount: true, discountType: 'BOGO' }),
  true,
);
assert.strictEqual(
  hasActiveBogoPromotion({ hasDiscount: true, discountType: 'BOGOHO' }),
  true,
);
assert.strictEqual(
  hasActiveBogoPromotion({ hasDiscount: false, discountType: 'BOGO' }),
  false,
);
assert.strictEqual(
  hasActiveBogoPromotion({ hasDiscount: true, discountType: 'FIXED' }),
  false,
);
assert.strictEqual(
  getComboSubItemId({ menuItem: { _id: 'nested-id' } }),
  'nested-id',
);
assert.strictEqual(getComboSubItemId({ menuItem: 'flat-id' }), 'flat-id');

console.log('combo promotion helper tests passed');
