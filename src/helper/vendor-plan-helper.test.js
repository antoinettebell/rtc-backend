const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  VENDOR_PLAN_TIERS,
  canAccessEventMarketplace,
  canUseCashPOS,
  canUseTapToPay,
  canUseWalkupPOS,
  assertWalkUpPosPaymentMethodAllowed,
  normalizeVendorPlan,
} = require('./vendor-plan-helper');

const basic = VENDOR_PLAN_TIERS.SUB_BASIC;
const marketplace = VENDOR_PLAN_TIERS.SUB_MARKETPLACE_VENDOR;
const platinum = VENDOR_PLAN_TIERS.SUB_PLATINUM;
const elite = VENDOR_PLAN_TIERS.SUB_ELITE;
const plans = [basic, platinum, elite];

for (const plan of plans) {
  assert(plan.details.includes('Delivery/Pickup Ordering Fulfillment'));
  assert(plan.details.includes('Bluetooth Order/Receipt Printing'));
  assert(plan.details.includes('Sales Tax Reporting'));
  assert(!plan.details.some((detail) => /delivery acceptance/i.test(detail)));
  assert(!plan.details.some((detail) => /preorder ordering/i.test(detail)));
  assert(!plan.details.some((detail) => /^tap to pay$/i.test(detail)));
}

assert(!basic.details.includes('1099 Reporting'));
assert(platinum.details.includes('1099 Reporting'));
assert(elite.details.includes('1099 Reporting'));

assert.strictEqual(basic.capabilities.employeeLogin, false);
assert.strictEqual(canUseWalkupPOS({ slug: 'SUB_BASIC' }), false);
assert.strictEqual(canUseWalkupPOS({ slug: 'SUB_PLATINUM' }), true);
assert.strictEqual(canUseWalkupPOS({ slug: 'SUB_ELITE' }), true);
assert.strictEqual(
  canUseWalkupPOS({ slug: 'SUB_ELITE', capabilities: { employeeWalkUpPos: false, walkUpPosPaymentMethods: [] } }),
  false
);
assert.strictEqual(
  canUseWalkupPOS({ slug: 'SUB_BASIC', capabilities: { walkUpPos: true, walkUpPosPaymentMethods: ['CASH'] } }),
  true
);
assert.throws(() => {
  try {
    assertWalkUpPosPaymentMethodAllowed({ slug: 'SUB_BASIC' }, 'CASH');
  } catch (error) {
    assert.strictEqual(error.code, 403);
    assert.strictEqual(
      error.message,
      'Walk-up ordering is not included in your current plan. Upgrade your plan to use this feature.'
    );
    throw error;
  }
}, /Walk-up ordering is not included/);
assert.strictEqual(marketplace.rate, 3.5);
assert.strictEqual(marketplace.rateType, 'AWARD_CHECKOUT');
assert.strictEqual(marketplace.capabilities.vendorSubtype, 'EVENT_VENDOR');
assert.strictEqual(marketplace.capabilities.maxSocialMediaLinks, 2);
assert.strictEqual(marketplace.capabilities.maxGalleryPhotos, 10);
assert.strictEqual(marketplace.capabilities.employeeLogin, false);
assert.strictEqual(marketplace.capabilities.deliveryAcceptance, false);
assert.strictEqual(platinum.capabilities.employeeLogin, true);
assert.strictEqual(elite.capabilities.eventMarketplace, true);
assert.deepStrictEqual(elite.capabilities.walkUpPosPaymentMethods, [
  'CASH',
  'TAP_TO_PAY',
]);

const legacyElite = { name: 'Elite Plan', rate: 5.5 };
assert.strictEqual(canAccessEventMarketplace(legacyElite), true);
assert.strictEqual(canUseCashPOS(legacyElite), true);
assert.strictEqual(canUseTapToPay(legacyElite), true);
assert.strictEqual(normalizeVendorPlan(legacyElite).capabilities.tapToPay, true);

const orderControllerSource = fs.readFileSync(
  path.join(__dirname, '../v1/controllers/order-controller.js'),
  'utf8'
);
const validateOrderSource = orderControllerSource.slice(
  orderControllerSource.indexOf('exports.validateOrder'),
  orderControllerSource.indexOf('exports.add')
);
const addOrderSource = orderControllerSource.slice(
  orderControllerSource.indexOf('exports.add')
);
assert.match(validateOrderSource, /await assertVendorPosAccess\(foodTruck, paymentMethod \|\| 'CASH'\)/);
assert.match(addOrderSource, /await assertVendorPosAccess\(foodTruck, normalizedPaymentMethod\)/);
assert.match(orderControllerSource, /WALK_UP_ORDER_SOURCES/);

console.log('Vendor plan catalog tests passed.');
