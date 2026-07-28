const assert = require('assert');
const { VENDOR_PLAN_TIERS } = require('./vendor-plan-helper');

const basic = VENDOR_PLAN_TIERS.SUB_BASIC;
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
assert.strictEqual(platinum.capabilities.employeeLogin, true);
assert.strictEqual(elite.capabilities.eventMarketplace, true);
assert.deepStrictEqual(elite.capabilities.walkUpPosPaymentMethods, [
  'CASH',
  'TAP_TO_PAY',
]);

console.log('Vendor plan catalog tests passed.');
