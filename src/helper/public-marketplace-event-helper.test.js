const assert = require('assert');
const {
  filterActivePublicMarketplaceEvents,
  isMarketplaceEventExpired,
} = require('./public-marketplace-event-helper');

const event = (overrides = {}) => ({
  event_date: new Date('2026-08-08T00:00:00.000Z'),
  event_time: '10:00',
  event_duration_hours: 4,
  event_duration_minutes: 0,
  event_timezone: 'America/New_York',
  ...overrides,
});
assert.equal(isMarketplaceEventExpired(event(), new Date('2026-08-08T17:59:59Z')), false);
assert.equal(isMarketplaceEventExpired(event(), new Date('2026-08-08T18:00:01Z')), true);
assert.equal(isMarketplaceEventExpired(event({ event_duration_hours: 48 }), new Date('2026-08-09T18:00:00Z')), false);
assert.equal(isMarketplaceEventExpired(event({ event_timezone: 'America/Los_Angeles' }), new Date('2026-08-08T20:00:00Z')), false);
assert.equal(filterActivePublicMarketplaceEvents([
  event({ event_id: 'expired' }),
  event({ event_id: 'active', event_duration_hours: 48 }),
], new Date('2026-08-09T18:00:00Z')).map((item) => item.event_id).join(','), 'active');
console.log('Public marketplace expiration tests passed.');
