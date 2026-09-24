const assert = require('assert');
const router = require('./marketplace');

const route = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods?.[method]);
const customerRoutes = [
  route('/events/:eventId/ticket-staff', 'get'),
  route('/events/:eventId/ticket-staff', 'post'),
  route('/ticket-staff/:assignmentId/resend', 'post'),
  route('/ticket-staff/:assignmentId/revoke', 'post'),
  route('/ticket-staff/my', 'get'),
  route('/ticket-staff/:assignmentId/respond', 'post'),
  route('/ticket-staff/:assignmentId/scanner-session', 'post'),
];
const adminRoutes = [
  route('/admin/ticket-staff', 'get'),
  route('/admin/events/:eventId/ticket-staff', 'post'),
  route('/admin/ticket-staff/:assignmentId/resend', 'post'),
  route('/admin/ticket-staff/:assignmentId/revoke', 'post'),
];
customerRoutes.forEach((value) => assert(value, 'Ticket staff customer route must exist'));
adminRoutes.forEach((value) => assert(value, 'Ticket staff admin route must exist'));

const guard = (target, userType) => new Promise((resolve) => {
  const req = { user: { userType } };
  const res = { error: (_error, status) => resolve(status) };
  target.route.stack[0].handle(req, res, () => resolve(200));
});

(async () => {
  for (const target of customerRoutes) {
    assert.equal(await guard(target, 'CUSTOMER'), 200);
    assert.equal(await guard(target, 'VENDOR'), 403);
  }
  for (const target of adminRoutes) {
    assert.equal(await guard(target, 'SUPER_ADMIN'), 200);
    assert.equal(await guard(target, 'CUSTOMER'), 403);
    assert.equal(await guard(target, 'VENDOR'), 403);
  }
  console.log('Marketplace ticket staff route-access tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
