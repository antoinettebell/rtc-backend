const assert = require('assert');
const {
  getMarketplaceAwardRevocationDecision,
  getMarketplaceAwardRevocationError,
} = require('./marketplace-award-revocation');

const event = {
  event_date: '2026-09-10T00:00:00.000Z',
  event_time: '4:00 PM',
  event_timezone: 'America/New_York',
};
const startAt = new Date('2026-09-10T20:00:00.000Z');
const cutoffAt = new Date(startAt.getTime() - 72 * 60 * 60 * 1000);

assert.equal(getMarketplaceAwardRevocationDecision({
  event,
  now: new Date(cutoffAt.getTime() - 1),
}).canRevoke, true);
const exactBoundary = getMarketplaceAwardRevocationDecision({ event, now: cutoffAt });
assert.equal(exactBoundary.canRevoke, false);
assert.equal(exactBoundary.code, 'REVOCATION_WINDOW_CLOSED');
assert.equal(getMarketplaceAwardRevocationDecision({
  event,
  now: new Date(cutoffAt.getTime() + 1),
}).canRevoke, false);
const paid = getMarketplaceAwardRevocationDecision({
  event,
  vendorPaymentStatus: 'PAID',
  now: new Date(cutoffAt.getTime() - 1),
});
assert.equal(paid.canRevoke, false);
assert.equal(paid.code, 'PROCESSOR_REFUND_REQUIRED');
assert.match(getMarketplaceAwardRevocationError(paid), /verified processor refund/);
assert.equal(getMarketplaceAwardRevocationDecision({
  event,
  vendorPaymentStatus: 'PROCESSING',
  now: new Date(cutoffAt.getTime() - 1),
}).code, 'PAYMENT_PROCESSING');
assert.equal(getMarketplaceAwardRevocationDecision({ event: {}, now: new Date() }).code, 'EVENT_TIME_UNAVAILABLE');

console.log('marketplace award revocation tests passed');
