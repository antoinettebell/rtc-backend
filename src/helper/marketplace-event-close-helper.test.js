const assert = require('assert');
const {
  buildVendorEventCloseState,
  getMarketplaceEventTiming,
} = require('./marketplace-event-close-helper');

const event = {
  event_date: new Date('2026-08-04T00:00:00.000Z'),
  event_time: '18:30',
  event_timezone: 'America/New_York',
  event_duration_minutes: 120,
  final_payment_status: 'NOT_REQUIRED',
};
const timing = getMarketplaceEventTiming(event);
assert.strictEqual(timing.start_at.toISOString(), '2026-08-04T22:30:00.000Z');
assert.strictEqual(timing.end_at.toISOString(), '2026-08-05T00:30:00.000Z');
assert.strictEqual(timing.vendor_close_available_at.toISOString(), '2026-08-05T01:30:00.000Z');

const waiting = buildVendorEventCloseState(event, new Date('2026-08-05T01:00:00.000Z'));
assert.strictEqual(waiting.can_close, false);
assert.strictEqual(waiting.status, 'WAITING_FOR_COORDINATOR');
assert.strictEqual(waiting.seconds_remaining, 1800);

const available = buildVendorEventCloseState(event, new Date('2026-08-05T01:30:00.000Z'));
assert.strictEqual(available.can_close, true);
assert.strictEqual(available.status, 'AVAILABLE');

const paid = buildVendorEventCloseState({
  ...event,
  final_payment_id: 'payment-1',
  final_payment_status: 'PAID',
}, new Date('2026-08-06T00:00:00.000Z'));
assert.strictEqual(paid.can_close, false);
assert.strictEqual(paid.status, 'PAID');

const winterTiming = getMarketplaceEventTiming({
  ...event,
  event_date: new Date('2026-12-04T00:00:00.000Z'),
});
assert.strictEqual(winterTiming.start_at.toISOString(), '2026-12-04T23:30:00.000Z');

console.log('marketplace event close helper tests passed');
