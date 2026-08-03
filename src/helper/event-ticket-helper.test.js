const assert = require('assert');
const {
  getAdmissionsTaxCode,
  getEntityUseCode,
  calculateTicketAmounts,
  assertInventoryAvailable,
  calculateMinimumFoodVendors,
  isScannerAvailable,
  eventStartUtc,
  cancellationDeadline,
  encodeWalletPaymentToken,
} = require('./event-ticket-helper');

assert.strictEqual(getAdmissionsTaxCode('Live Music / Concerts'), 'OA020200');
assert.strictEqual(getAdmissionsTaxCode('Sporting Events'), 'OA020400');
assert.strictEqual(getAdmissionsTaxCode('Theaters / Plays'), 'OA020800');
assert.strictEqual(getAdmissionsTaxCode('Amusement / Attractions'), 'OA020100');
assert.strictEqual(getAdmissionsTaxCode('Community Gathering'), 'OA020000');
assert.strictEqual(getAdmissionsTaxCode(), 'OA020000');

assert.strictEqual(
  getEntityUseCode({ charitableEvent: true, religiousOrganization: false }),
  'E'
);

assert.strictEqual(
  eventStartUtc({
    eventDate: '2026-08-10',
    eventTime: '8:00 PM',
    timeZone: 'America/New_York',
  }).toISOString(),
  '2026-08-11T00:00:00.000Z'
);
assert.strictEqual(
  cancellationDeadline({
    event_date: '2026-08-10',
    event_time: '8:00 PM',
    event_timezone: 'America/New_York',
  }).toISOString(),
  '2026-08-08T00:00:00.000Z'
);

assert.strictEqual(
  isScannerAvailable({
    eventDate: '2026-08-10',
    timeZone: 'America/New_York',
    now: new Date('2026-08-10T09:59:00Z'),
  }),
  false
);
assert.strictEqual(
  isScannerAvailable({
    eventDate: '2026-08-10',
    timeZone: 'America/New_York',
    now: new Date('2026-08-10T10:00:00Z'),
  }),
  true
);
assert.strictEqual(
  isScannerAvailable({
    eventDate: '2026-08-10',
    timeZone: 'America/New_York',
    now: new Date('2026-08-11T05:00:00Z'),
  }),
  true
);
assert.strictEqual(
  isScannerAvailable({
    eventDate: '2026-08-10',
    now: new Date('2026-08-10T12:00:00Z'),
    closedAt: new Date(),
  }),
  false
);
assert.strictEqual(
  getEntityUseCode({ charitableEvent: false, religiousOrganization: true }),
  'F'
);
assert.strictEqual(
  getEntityUseCode({ charitableEvent: false, religiousOrganization: false }),
  null
);

assert.deepStrictEqual(calculateTicketAmounts({ unitPrice: 50, quantity: 2 }), {
  ticketSubtotal: 100,
  customerProcessingFee: 3.5,
  coordinatorProcessingFee: 3.5,
  checkoutSubtotal: 103.5,
  grossCoordinatorPayoutBeforeTax: 96.5,
});

const appleToken = { data: 'encrypted', signature: 'signed', version: 'EC_v1' };
assert.deepStrictEqual(
  JSON.parse(Buffer.from(encodeWalletPaymentToken(appleToken), 'base64').toString()),
  appleToken
);
assert.strictEqual(
  Buffer.from(encodeWalletPaymentToken('{"google":"token"}'), 'base64').toString(),
  '{"google":"token"}'
);
assert.throws(() => encodeWalletPaymentToken(null), /Payment token missing/);

assert.strictEqual(
  assertInventoryAvailable({ capacity: 100, sold: 94, reserved: 2, requested: 4 }),
  0
);
assert.throws(
  () =>
    assertInventoryAvailable({ capacity: 100, sold: 94, reserved: 2, requested: 5 }),
  (error) => error.code === 'TICKET_INVENTORY_EXCEEDED' && error.remaining === 4
);

assert.strictEqual(
  calculateMinimumFoodVendors({ gaGuests: 150, vipGuests: 30, vipHasSeparateCaterer: false }),
  2
);
assert.strictEqual(
  calculateMinimumFoodVendors({ gaGuests: 150, vipGuests: 30, vipHasSeparateCaterer: true }),
  2
);
assert.strictEqual(
  calculateMinimumFoodVendors({ gaGuests: 0, vipGuests: 0, vipHasSeparateCaterer: true }),
  1
);

console.log('event ticket helper tests passed');
