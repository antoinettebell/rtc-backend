const assert = require('assert');

const { validateAdminEventPublish } = require('./marketplace-admin-event-policy');

const baseEvent = {
  payment_responsibility: 'BOTH',
  vendor_fee: 25,
  budgeted_amount: 1000,
  ga_ticket_quantity: 100,
  vip_ticket_quantity: 20,
  number_of_vendors_needed: 2,
  number_of_guests: 100,
  vip_guest_count: 20,
  event_vendor_needs: [
    { vendor_type: 'MERCHANDISE', type_description: 'Retail goods', quantity: 2, fee: 10 },
    { vendor_type: 'SERVICE', type_description: 'Guest services', quantity: 1, fee: 15 },
  ],
};

assert.deepStrictEqual(validateAdminEventPublish({
  current: baseEvent,
  proposed: {
    ...baseEvent,
    ga_ticket_quantity: 120,
    vip_ticket_quantity: 25,
    number_of_vendors_needed: 3,
    event_vendor_needs: [
      { vendor_type: 'SERVICE', type_description: 'Guest services', quantity: 2, fee: 15 },
      { vendor_type: 'MERCHANDISE', type_description: 'Retail goods', quantity: 3, fee: 10 },
    ],
  },
  hasActivity: true,
}), []);

const reductions = validateAdminEventPublish({
  current: baseEvent,
  proposed: {
    ...baseEvent,
    ga_ticket_quantity: 99,
    number_of_vendors_needed: 1,
    event_vendor_needs: [{ vendor_type: 'MERCHANDISE', type_description: 'Retail goods', quantity: 1, fee: 10 }],
  },
  hasActivity: false,
});
assert.ok(reductions.some(({ field }) => field === 'ga_ticket_quantity'));
assert.ok(reductions.some(({ field }) => field === 'number_of_vendors_needed'));
assert.ok(reductions.some(({ field }) => field === 'event_vendor_needs.MERCHANDISE.quantity'));

const activityLocks = validateAdminEventPublish({
  current: baseEvent,
  proposed: {
    ...baseEvent,
    vendor_fee: 30,
    event_vendor_needs: [
      { vendor_type: 'MERCHANDISE', type_description: 'Retail goods', quantity: 2, fee: 12 },
      { vendor_type: 'SERVICE', type_description: 'Guest services', quantity: 1, fee: 15 },
    ],
  },
  hasActivity: true,
});
assert.ok(activityLocks.some(({ field }) => field === 'vendor_fee'));
assert.ok(activityLocks.some(({ field }) => field === 'event_vendor_needs'));

const descriptionLock = validateAdminEventPublish({
  current: baseEvent,
  proposed: {
    ...baseEvent,
    event_vendor_needs: [
      { vendor_type: 'MERCHANDISE', type_description: 'Changed goods', quantity: 2, fee: 10 },
      { vendor_type: 'SERVICE', type_description: 'Guest services', quantity: 1, fee: 15 },
    ],
  },
  hasActivity: true,
});
assert.ok(descriptionLock.some(({ field }) => field === 'event_vendor_needs'));

console.log('marketplace admin event policy tests passed');
