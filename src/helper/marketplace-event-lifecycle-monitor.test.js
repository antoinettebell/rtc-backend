const assert = require('assert');
const {
  getMarketplaceLifecycleUpdate,
} = require('./marketplace-event-lifecycle-monitor');

const baseEvent = {
  status: 'OPEN',
  event_date: '2026-09-23',
  event_time: '3:30 PM',
  event_timezone: 'America/New_York',
  event_duration_hours: 4,
  event_duration_minutes: 0,
  ticket_sales_enabled: true,
  ticket_sales_closed_at: null,
  ticket_scanning_closed_at: null,
  vendor_applications_closed_at: null,
};

assert.equal(
  getMarketplaceLifecycleUpdate(
    baseEvent,
    new Date('2026-09-23T23:29:59.000Z')
  ),
  null
);

const ended = getMarketplaceLifecycleUpdate(
  baseEvent,
  new Date('2026-09-23T23:30:00.000Z')
);
assert.ok(ended.ticket_sales_closed_at);
assert.equal(ended.status, undefined);
assert.equal(ended.ticket_scanning_closed_at, undefined);

const scannerExpired = getMarketplaceLifecycleUpdate(
  { ...baseEvent, ticket_sales_closed_at: new Date() },
  new Date('2026-09-24T19:30:00.000Z')
);
assert.ok(scannerExpired.ticket_scanning_closed_at);
assert.equal(scannerExpired.status, 'CLOSED');
assert.ok(scannerExpired.closed_at);
assert.ok(scannerExpired.vendor_applications_closed_at);

const manuallyClosedBeforeEnd = getMarketplaceLifecycleUpdate(
  {
    ...baseEvent,
    ticket_scanning_closed_at: new Date('2026-09-23T22:00:00.000Z'),
  },
  new Date('2026-09-23T23:29:59.000Z')
);
assert.equal(manuallyClosedBeforeEnd, null);

const manuallyClosedAtEnd = getMarketplaceLifecycleUpdate(
  {
    ...baseEvent,
    ticket_scanning_closed_at: new Date('2026-09-23T22:00:00.000Z'),
  },
  new Date('2026-09-23T23:30:00.000Z')
);
assert.equal(manuallyClosedAtEnd.status, 'CLOSED');

const nonTicketed = { ...baseEvent, ticket_sales_enabled: false };
assert.equal(
  getMarketplaceLifecycleUpdate(
    nonTicketed,
    new Date('2026-09-24T23:29:59.000Z')
  ),
  null
);
const nonTicketedClosed = getMarketplaceLifecycleUpdate(
  nonTicketed,
  new Date('2026-09-24T23:30:00.000Z')
);
assert.equal(nonTicketedClosed.status, 'CLOSED');
assert.equal(nonTicketedClosed.ticket_sales_closed_at, undefined);

assert.equal(
  getMarketplaceLifecycleUpdate(
    { ...baseEvent, event_duration_hours: 0 },
    new Date('2026-09-30T00:00:00.000Z')
  ),
  null
);

console.log('marketplace event lifecycle monitor tests passed');
