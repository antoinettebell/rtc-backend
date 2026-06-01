const assert = require('assert');
const {
  calculateVendorEarnings,
  resolveVendorTierRate,
} = require('./vendor-earnings-helper');

const sample = calculateVendorEarnings({
  subTotal: 10,
  totalAfterDiscount: 8,
  discount: 2,
  tipsAmount: 0,
  vendor_tier_at_transaction: { slug: 'SUB_BASIC', rate: 3.5 },
});

assert.deepStrictEqual(sample, {
  foodSalesBase: 10,
  foodTruckTip: 0,
  tierRate: 3.5,
  tierFee: 0.35,
  vendorEarnings: 9.65,
});

const withTip = calculateVendorEarnings({
  subTotal: 10,
  tipsAmount: 2,
  vendor_tier_at_transaction: { slug: 'SUB_BASIC', rate: 3.5 },
});

assert.strictEqual(withTip.tierFee, 0.35);
assert.strictEqual(withTip.vendorEarnings, 11.65);

const legacyOrder = calculateVendorEarnings(
  {
    totalAfterDiscount: 8,
    discount: 2,
    vendor_tier_at_transaction: null,
  },
  4.5
);

assert.strictEqual(legacyOrder.foodSalesBase, 10);
assert.strictEqual(legacyOrder.tierRate, 4.5);
assert.strictEqual(legacyOrder.vendorEarnings, 9.55);

assert.strictEqual(resolveVendorTierRate({ slug: 'SUB_ELITE' }), 5.5);

console.log('vendor earnings helper tests passed');
