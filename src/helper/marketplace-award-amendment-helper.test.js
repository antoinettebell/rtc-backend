const assert = require('assert');
const {
  buildReplacementBidAmounts,
  canRequestVipAwardAmendment,
  getAwardedEventStatus,
  getVipAwardAmountField,
  isSolelyPrivateCateredEvent,
  isVipCapacityIncreaseLocked,
  VIP_CAPACITY_LOCK_MESSAGE,
} = require('./marketplace-award-amendment-helper');

assert.equal(
  VIP_CAPACITY_LOCK_MESSAGE,
  'Event is less or equal to 72hrs away, please contact your vendor directly to discuss possible cost changes.'
);

const privateCatered = {
  event_visibility: 'PRIVATE',
  ticket_sales_enabled: false,
  fully_catered_event: true,
  status: 'OPEN',
};

assert.equal(isSolelyPrivateCateredEvent(privateCatered), true);
assert.equal(getAwardedEventStatus(privateCatered, true), 'AWARDED');
assert.equal(getAwardedEventStatus({ ...privateCatered, ticket_sales_enabled: true }, true), 'OPEN');
assert.equal(getAwardedEventStatus({ ...privateCatered, event_visibility: 'PUBLIC' }, true), 'OPEN');
assert.equal(getAwardedEventStatus(privateCatered, false), 'OPEN');

assert.equal(canRequestVipAwardAmendment({
  event: { status: 'AWARDED' },
  awardedBids: [{ awarded_coverage: 'VIP' }],
}), true);
assert.equal(canRequestVipAwardAmendment({
  event: { status: 'OPEN', event_visibility: 'PUBLIC', ticket_sales_enabled: true },
  awardedBids: [{ awarded_coverage: 'BOTH' }],
}), true);
assert.equal(canRequestVipAwardAmendment({
  event: { status: 'CLOSED', event_visibility: 'PUBLIC', ticket_sales_enabled: true },
  awardedBids: [{ awarded_coverage: 'VIP' }],
}), true);
assert.equal(canRequestVipAwardAmendment({
  event: { status: 'CANCELLED' },
  awardedBids: [{ awarded_coverage: 'VIP' }],
}), false);
assert.equal(canRequestVipAwardAmendment({
  event: { status: 'OPEN' },
  awardedBids: [{ awarded_coverage: 'REGULAR' }],
}), false);

const eventTiming = { start_at: new Date('2026-09-26T12:00:00.000Z') };
assert.equal(isVipCapacityIncreaseLocked({
  currentCapacity: 20,
  proposedCapacity: 21,
  eventTiming,
  now: new Date('2026-09-23T12:00:00.000Z'),
}), true);
assert.equal(isVipCapacityIncreaseLocked({
  currentCapacity: 20,
  proposedCapacity: 21,
  eventTiming,
  now: new Date('2026-09-23T11:59:59.000Z'),
}), false);
assert.equal(isVipCapacityIncreaseLocked({
  currentCapacity: 20,
  proposedCapacity: 20,
  eventTiming,
  now: new Date('2026-09-25T12:00:00.000Z'),
}), false);

assert.equal(getVipAwardAmountField({ awarded_coverage: 'VIP' }), 'full_bid_amount');
assert.equal(getVipAwardAmountField({ awarded_coverage: 'BOTH' }), 'vip_catering_amount');
assert.equal(getVipAwardAmountField({ awarded_coverage: 'REGULAR' }), null);

assert.deepStrictEqual(buildReplacementBidAmounts({
  bid: { awarded_coverage: 'VIP', full_bid_amount: 500 },
  proposedAmount: 650.25,
}), { full_bid_amount: 650.25, total_bid_amount: 650.25 });

assert.deepStrictEqual(buildReplacementBidAmounts({
  bid: {
    awarded_coverage: 'BOTH',
    regular_guest_amount: 400,
    vip_catering_amount: 300,
    specialty_services: ['DESSERTS'],
    dessert_bid_amount: 50,
  },
  proposedAmount: 425.5,
  event: { fully_catered_event: true },
}), {
  vip_catering_amount: 425.5,
  full_bid_amount: 825.5,
  total_bid_amount: 875.5,
});

console.log('marketplace award amendment helper tests passed');
