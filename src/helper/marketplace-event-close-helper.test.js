const assert = require('assert');
const {
  buildVendorEventCloseState,
  combineMarketplaceDateAndTime,
  formatMarketplaceCalendarDate,
  formatMarketplaceClockTime,
  getMarketplaceEventTiming,
  isMarketplaceCloseBeforeEvent,
  isFinalPaymentAvailable,
} = require('./marketplace-event-close-helper');

assert.strictEqual(formatMarketplaceCalendarDate('2026-08-18T00:00:00.000Z'), '08/18/2026');
assert.strictEqual(formatMarketplaceCalendarDate(new Date('2026-08-18T00:00:00.000Z')), '08/18/2026');
assert.strictEqual(formatMarketplaceClockTime('01:15'), '1:15 AM');
assert.strictEqual(formatMarketplaceClockTime('13:15'), '1:15 PM');
assert.strictEqual(formatMarketplaceClockTime('9:05 PM'), '9:05 PM');

assert.strictEqual(
  combineMarketplaceDateAndTime({
    dateValue: '2026-08-17T00:00:00.000Z',
    timeValue: '21:30',
    timeZone: 'America/New_York',
  }).toISOString(),
  '2026-08-18T01:30:00.000Z'
);
assert.strictEqual(
  isMarketplaceCloseBeforeEvent({
    eventDate: '2026-08-18T00:00:00.000Z',
    eventTime: '23:00',
    eventCloseAt: '2026-08-19T02:59:59.000Z',
    timeZone: 'America/New_York',
  }),
  true
);
assert.strictEqual(
  isMarketplaceCloseBeforeEvent({
    eventDate: '2026-08-18T00:00:00.000Z',
    eventTime: '23:00',
    eventCloseAt: '2026-08-19T03:00:00.000Z',
    timeZone: 'America/New_York',
  }),
  false
);
const easternSubmissionDeadline = combineMarketplaceDateAndTime({
  dateValue: '2026-08-17',
  timeValue: '21:30',
  timeZone: 'America/New_York',
});
assert.strictEqual(new Date('2026-08-18T01:29:59.999Z') < easternSubmissionDeadline, true);
assert.strictEqual(new Date('2026-08-18T01:30:00.000Z') >= easternSubmissionDeadline, true);
assert.strictEqual(
  combineMarketplaceDateAndTime({
    dateValue: '2026-08-17',
    timeValue: '21:30',
    timeZone: 'America/Los_Angeles',
  }).toISOString(),
  '2026-08-18T04:30:00.000Z'
);

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
assert.strictEqual(timing.final_payment_available_at.toISOString(), '2026-08-04T22:30:00.000Z');
assert.strictEqual(timing.vendor_close_available_at.toISOString(), '2026-08-04T22:30:00.000Z');
assert.strictEqual(isFinalPaymentAvailable(event, new Date('2026-08-04T22:29:59.000Z')), false);
assert.strictEqual(isFinalPaymentAvailable(event, new Date('2026-08-04T22:30:00.000Z')), true);

const waiting = buildVendorEventCloseState(event, new Date('2026-08-04T22:29:59.000Z'));
assert.strictEqual(waiting.can_close, false);
assert.strictEqual(waiting.status, 'WAITING_FOR_EVENT_START');
assert.strictEqual(waiting.seconds_remaining, 1);

const available = buildVendorEventCloseState(event, new Date('2026-08-04T22:30:00.000Z'));
assert.strictEqual(available.can_close, true);
assert.strictEqual(available.status, 'AVAILABLE');

const pending = buildVendorEventCloseState({
  ...event,
  final_payment_id: 'payment-pending',
  final_payment_status: 'PENDING',
}, new Date('2026-08-04T23:00:00.000Z'));
assert.strictEqual(pending.can_close, false);
assert.strictEqual(pending.status, 'PAYMENT_CREATED');

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

const midnightTiming = getMarketplaceEventTiming({
  ...event,
  event_time: '00:00',
  event_duration_minutes: 60,
});
assert.strictEqual(midnightTiming.start_at.toISOString(), '2026-08-04T04:00:00.000Z');
assert.strictEqual(midnightTiming.end_at.toISOString(), '2026-08-04T05:00:00.000Z');

const crossMidnightTiming = getMarketplaceEventTiming({
  ...event,
  event_time: '23:30',
  event_duration_minutes: 120,
});
assert.strictEqual(crossMidnightTiming.start_at.toISOString(), '2026-08-05T03:30:00.000Z');
assert.strictEqual(crossMidnightTiming.end_at.toISOString(), '2026-08-05T05:30:00.000Z');

console.log('marketplace event close helper tests passed');
