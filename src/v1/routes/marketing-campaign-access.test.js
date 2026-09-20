const assert = require('node:assert/strict');
const test = require('node:test');
const { allowedTo } = require('../../middleware/allow-route');

function exercise(userType) {
  return new Promise((resolve) => {
    const req = { user: { userType } };
    const res = { error(error, status) { resolve({ nextCalled: false, status, message: error.message }); } };
    allowedTo(['SUPER_ADMIN'])(req, res, () => resolve({ nextCalled: true }));
  });
}

test('marketing campaign routes are SUPER_ADMIN only', async () => {
  assert.deepEqual(await exercise('SUPER_ADMIN'), { nextCalled: true });
  const vendor = await exercise('VENDOR');
  assert.equal(vendor.nextCalled, false);
  assert.equal(vendor.status, 403);
});
