const assert = require('assert');
const marketplaceRouter = require('./marketplace');

const findRoute = (path, method) => marketplaceRouter.stack.find(
  (layer) => layer.route?.path === path && layer.route.methods?.[method]
);

const listRoute = findRoute('/events/:eventId/award-amendments', 'get');
const updateGuestCountRoute = findRoute('/events/:eventId/award-amendments/vip-guest-count', 'patch');
const respondRoute = findRoute('/award-amendments/:amendmentId/respond', 'post');
const acceptRoute = findRoute('/award-amendments/:amendmentId/accept', 'post');
const rejectRoute = findRoute('/award-amendments/:amendmentId/reject', 'post');

assert(listRoute, 'award-amendment list route must exist');
assert(updateGuestCountRoute, 'awarded VIP guest-count route must exist');
assert(respondRoute, 'award-amendment response route must exist');
assert(acceptRoute, 'award-amendment accept route must exist');
assert(rejectRoute, 'award-amendment reject route must exist');

const exerciseGuard = (route, userType) => new Promise((resolve) => {
  let nextCalled = false;
  const req = { user: { userType } };
  const res = {
    error: (error, status) => resolve({ nextCalled, status, message: error.message }),
  };
  route.route.stack[0].handle(req, res, () => {
    nextCalled = true;
    resolve({ nextCalled, status: null });
  });
});

(async () => {
  for (const userType of ['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']) {
    assert.equal((await exerciseGuard(listRoute, userType)).nextCalled, true);
  }
  assert.equal((await exerciseGuard(updateGuestCountRoute, 'CUSTOMER')).nextCalled, true);
  assert.equal((await exerciseGuard(updateGuestCountRoute, 'VENDOR')).status, 403);
  assert.equal((await exerciseGuard(updateGuestCountRoute, 'SUPER_ADMIN')).status, 403);
  assert.equal((await exerciseGuard(respondRoute, 'VENDOR')).nextCalled, true);
  assert.equal((await exerciseGuard(respondRoute, 'CUSTOMER')).status, 403);
  for (const route of [acceptRoute, rejectRoute]) {
    assert.equal((await exerciseGuard(route, 'CUSTOMER')).nextCalled, true);
    assert.equal((await exerciseGuard(route, 'SUPER_ADMIN')).nextCalled, true);
    assert.equal((await exerciseGuard(route, 'VENDOR')).status, 403);
  }
  console.log('Marketplace award amendment route-access tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
