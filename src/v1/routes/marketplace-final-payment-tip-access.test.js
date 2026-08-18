const assert = require('assert');
const marketplaceRouter = require('./marketplace');

const tipRoute = marketplaceRouter.stack.find(
  (layer) =>
    layer.route?.path === '/payments/:paymentId/tip' &&
    layer.route.methods?.patch
);

assert(tipRoute, 'Final-event tip route must exist');

const exerciseGuard = (userType) =>
  new Promise((resolve) => {
    let nextCalled = false;
    const req = { user: { userType } };
    const res = {
      error: (error, status) => resolve({ nextCalled, status, message: error.message }),
    };
    tipRoute.route.stack[0].handle(req, res, () => {
      nextCalled = true;
      resolve({ nextCalled, status: null });
    });
  });

(async () => {
  assert.deepEqual(await exerciseGuard('CUSTOMER'), {
    nextCalled: true,
    status: null,
  });
  assert.deepEqual(await exerciseGuard('VENDOR'), {
    nextCalled: true,
    status: null,
  });
  const unauthorized = await exerciseGuard('EMPLOYEE');
  assert.equal(unauthorized.nextCalled, false);
  assert.equal(unauthorized.status, 403);
  assert.match(unauthorized.message, /access to this route/);

  console.log('Marketplace final-payment tip route-access tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
