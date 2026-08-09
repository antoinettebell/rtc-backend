const assert = require('assert');
const {
  filterActivePublicMarketplaceEvents,
  getPublicMarketplaceEventQuery,
  isMarketplaceEventExpired,
  isPublicMarketplaceEventEligible,
  sanitizePublicMarketplaceEvent,
} = require('./public-marketplace-event-helper');

const event = (overrides = {}) => ({
  status: 'OPEN',
  event_visibility: 'PUBLIC',
  tax_exemption_status: 'NOT_REQUESTED',
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
assert.deepEqual(getPublicMarketplaceEventQuery('event-1'), {
  event_id: 'event-1',
  status: 'OPEN',
  event_visibility: 'PUBLIC',
  tax_exemption_status: { $in: ['NOT_REQUESTED', 'APPROVED'] },
});
const beforeEnd = new Date('2026-08-08T17:00:00Z');
assert.equal(isPublicMarketplaceEventEligible(event(), beforeEnd), true);
assert.equal(isPublicMarketplaceEventEligible(event({ tax_exemption_status: 'APPROVED' }), beforeEnd), true);
assert.equal(isPublicMarketplaceEventEligible(event({ event_visibility: 'PRIVATE' }), beforeEnd), false);
assert.equal(isPublicMarketplaceEventEligible(event({ status: 'CLOSED' }), beforeEnd), false);
assert.equal(isPublicMarketplaceEventEligible(event({ tax_exemption_status: 'PENDING' }), beforeEnd), false);
assert.equal(isPublicMarketplaceEventEligible(event(), new Date('2026-08-08T19:00:00Z')), false);
const sanitized = sanitizePublicMarketplaceEvent({
  ...event(),
  event_id: 'event-1',
  event_name: 'Public Festival',
  ga_ticket_price: 25,
  tax_exemption_certificate_url: 'https://private/certificate.pdf',
  tax_exemption_certificate: { file_url: 'https://private/certificate.pdf' },
  coordinator_tax_id: 'secret',
  payment_handle: '$private',
  agreement_document_url: 'https://private/agreement.pdf',
  images: [{
    image_id: 'image-1', image_url: 'https://public/event.jpg',
    image_key: 'private-storage-key', uploaded_by_user_id: 'private-user',
    original_name: 'event.jpg', mime_type: 'image/jpeg',
  }],
});
assert.equal(sanitized.event_name, 'Public Festival');
assert.equal(sanitized.ga_ticket_price, 25);
assert.deepEqual(sanitized.images, [{ image_url: 'https://public/event.jpg' }]);
assert.equal(sanitized.tax_exemption_certificate_url, undefined);
assert.equal(sanitized.tax_exemption_certificate, undefined);
assert.equal(sanitized.coordinator_tax_id, undefined);
assert.equal(sanitized.payment_handle, undefined);
assert.equal(sanitized.agreement_document_url, undefined);
assert.equal(sanitized.images[0].image_key, undefined);
console.log('Public marketplace expiration tests passed.');
