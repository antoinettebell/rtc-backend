const assert = require('assert');
const router = require('./marketplace');

const route = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods?.[method]);
const vendorRoutes = [
  route('/event-vendor/tap-to-pay/activation-code', 'post'),
  route('/event-vendor/tap-to-pay/terminal', 'put'),
  route('/event-vendor/tap-to-pay/terminal-status', 'get'),
  route('/event-vendor/general-purchases/prepare', 'post'),
  route('/event-vendor/general-purchases/:purchaseId/complete', 'post'),
  route('/event-vendor/general-purchases/:purchaseId/cancel', 'post'),
  route('/event-vendor/general-purchases/:purchaseId/refund', 'post'),
  route('/event-vendor/general-purchases', 'get'),
];
vendorRoutes.forEach((value) => assert(value, 'Marketplace General Purchase route must exist'));
const adminRoute = route('/admin/event-vendors/:profileId/tap-to-pay-terminals/:terminalId', 'patch');
assert(adminRoute, 'Marketplace Vendor admin Tap to Pay route must exist');

const guard = (target, userType) => new Promise((resolve) => {
  const req = { user: { userType } };
  const res = { error: (_error, status) => resolve(status) };
  target.route.stack[0].handle(req, res, () => resolve(200));
});

(async () => {
  for (const target of vendorRoutes) {
    assert.equal(await guard(target, 'VENDOR'), 200);
    assert.equal(await guard(target, 'CUSTOMER'), 403);
  }
  assert.equal(await guard(adminRoute, 'SUPER_ADMIN'), 200);
  assert.equal(await guard(adminRoute, 'VENDOR'), 403);
  console.log('Marketplace General Purchase route-access tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
