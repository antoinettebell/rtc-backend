const assert = require('assert');
const {
  getAllowedBidCoverages,
  getAllowedAwardCoverages,
  getMarketplaceBudgetGuestCount,
  getMarketplaceVendorCapacity,
  getMarketplaceServiceRequirements,
  getMarketplaceFilledSlotSummary,
  isMarketplaceVendorReductionBlocked,
} = require('./marketplace-participation-helper');

const fullyCatered = {
  fully_catered_event: true,
  number_of_guests: 150,
  vip_guest_count: 50,
  vip_section_enabled: true,
};
assert.strictEqual(getMarketplaceBudgetGuestCount(fullyCatered), 200);
assert.deepStrictEqual(getAllowedBidCoverages(fullyCatered), [
  'REGULAR',
  'VIP',
  'BOTH',
]);
assert.deepStrictEqual(getMarketplaceVendorCapacity(fullyCatered), {
  gaMaximum: 2,
  vipRequirement: 1,
  calculatedMaximum: 2,
});
assert.deepStrictEqual(getMarketplaceServiceRequirements(fullyCatered), {
  gaRequirement: 2,
  vipRequirement: 1,
});
const fullyCateredGaOnly = {
  fully_catered_event: true,
  number_of_guests: 150,
  vip_section_enabled: false,
  vip_guest_count: 50,
};
assert.deepStrictEqual(getMarketplaceVendorCapacity(fullyCateredGaOnly), {
  gaMaximum: 2,
  vipRequirement: 0,
  calculatedMaximum: 2,
});
assert.deepStrictEqual(getMarketplaceServiceRequirements(fullyCateredGaOnly), {
  gaRequirement: 2,
  vipRequirement: 0,
});
assert.deepStrictEqual(
  getAllowedBidCoverages({
    ...fullyCateredGaOnly,
    dessert_caterer_required: true,
    drinks_caterer_required: true,
  }),
  ['REGULAR', 'VIP', 'BOTH', 'SPECIALTY'],
  'existing specialty routing must remain available for fully catered GA events',
);
assert.deepStrictEqual(
  getMarketplaceVendorCapacity({
    ...fullyCateredGaOnly,
    dessert_caterer_required: true,
    drinks_caterer_required: true,
  }),
  {
    gaMaximum: 2,
    vipRequirement: 0,
    dessertRequirement: 1,
    drinksRequirement: 1,
    calculatedMaximum: 4,
  },
  'Desserts and Drinks each add an awardable specialty slot to a fully catered GA event',
);
assert.deepStrictEqual(
  getMarketplaceServiceRequirements({
    ...fullyCateredGaOnly,
    dessert_caterer_required: true,
    drinks_caterer_required: true,
  }),
  {
    gaRequirement: 2,
    vipRequirement: 0,
    dessertRequirement: 1,
    drinksRequirement: 1,
  },
);

const vipWithGaSales = {
  catered_vip_section_enabled: true,
  ga_food_sales_allowed: true,
  number_of_guests: 150,
  vip_guest_count: 50,
  vip_section_enabled: true,
};
assert.strictEqual(getMarketplaceBudgetGuestCount(vipWithGaSales), 50);
assert.deepStrictEqual(getAllowedBidCoverages(vipWithGaSales), ['VIP', 'BOTH']);
assert.deepStrictEqual(getAllowedAwardCoverages(vipWithGaSales, 'VIP'), ['VIP']);
assert.deepStrictEqual(getAllowedAwardCoverages(vipWithGaSales, 'BOTH'), ['VIP', 'BOTH']);
assert.deepStrictEqual(getMarketplaceVendorCapacity(vipWithGaSales), {
  gaMaximum: 2,
  vipRequirement: 1,
  dessertRequirement: 0,
  drinksRequirement: 0,
  calculatedMaximum: 3,
});
assert.strictEqual(
  getMarketplaceVendorCapacity({
    ...vipWithGaSales,
    separate_vip_vendor_required: true,
  }).calculatedMaximum,
  3
);
assert.strictEqual(
  getMarketplaceVendorCapacity({ ...vipWithGaSales, ga_food_sales_allowed: false }).calculatedMaximum,
  3,
  'GA capacity must not be removed when GA selling is not permitted'
);
assert.strictEqual(
  getMarketplaceVendorCapacity({ ...vipWithGaSales, dessert_caterer_required: true, drinks_caterer_required: true }).calculatedMaximum,
  5,
  'Desserts and Drinks each add one specialty slot'
);
assert.deepStrictEqual(
  getAllowedBidCoverages({ ...vipWithGaSales, separate_vip_vendor_required: true }),
  ['VIP', 'BOTH']
);

assert.deepStrictEqual(
  getAllowedBidCoverages({ ...vipWithGaSales, ga_food_sales_allowed: false }),
  ['VIP']
);

const vendorPaidGa = { number_of_guests: 150, vip_guest_count: 0 };
assert.strictEqual(getMarketplaceBudgetGuestCount(vendorPaidGa), 150);
assert.deepStrictEqual(getAllowedBidCoverages(vendorPaidGa), ['REGULAR']);

const combinedBid = {
  vendor_user_id: 'combined-vendor',
  bid_status: 'AWARDED',
  awarded_coverage: 'BOTH',
  archived_at: null,
};
assert.deepStrictEqual(
  getMarketplaceFilledSlotSummary({
    bids: [combinedBid], gaRequirement: 2, vipRequirement: 1,
  }),
  {
    gaSlotsFilled: 1, vipSlotsFilled: 1, combinedVendors: 1,
    separateVipVendorRequired: false, minimumUniqueVendors: 1,
    totalServiceSlotsRequired: 3, totalServiceSlotsFilled: 2,
    remainingGaSlots: 1, remainingVipSlots: 0, remainingTotalServiceSlots: 1,
    remainingUniqueVendors: 1,
  }
);
assert.deepStrictEqual(
  getMarketplaceFilledSlotSummary({
    bids: [combinedBid], separateVipVendorRequired: true,
    gaRequirement: 1, vipRequirement: 1,
  }),
  {
    gaSlotsFilled: 1, vipSlotsFilled: 1, combinedVendors: 1,
    separateVipVendorRequired: true, minimumUniqueVendors: 1,
    totalServiceSlotsRequired: 2, totalServiceSlotsFilled: 2,
    remainingGaSlots: 0, remainingVipSlots: 0, remainingTotalServiceSlots: 0,
    remainingUniqueVendors: 0,
  }
);
const separateVendors = getMarketplaceFilledSlotSummary({
  applications: [{ vendor_user_id: 'ga-vendor', application_status: 'CONFIRMED', archived_at: null }],
  bids: [{ vendor_user_id: 'vip-vendor', bid_status: 'AWARDED', awarded_coverage: 'VIP', archived_at: null }],
  separateVipVendorRequired: true, gaRequirement: 1, vipRequirement: 1,
});
assert.strictEqual(separateVendors.totalServiceSlotsFilled, 2);
assert.strictEqual(separateVendors.minimumUniqueVendors, 2);
assert.strictEqual(separateVendors.remainingTotalServiceSlots, 0);
const fullyCateredFilled = getMarketplaceFilledSlotSummary({
  bids: [
    { ...combinedBid, vendor_user_id: 'combined' },
    { ...combinedBid, vendor_user_id: 'ga', awarded_coverage: 'REGULAR' },
  ],
  gaRequirement: 2,
  vipRequirement: 1,
});
assert.strictEqual(fullyCateredFilled.gaSlotsFilled, 2);
assert.strictEqual(fullyCateredFilled.vipSlotsFilled, 1);
assert.strictEqual(fullyCateredFilled.totalServiceSlotsFilled, 3);
assert.strictEqual(fullyCateredFilled.minimumUniqueVendors, 2);
assert.strictEqual(fullyCateredFilled.remainingTotalServiceSlots, 0);
const existingSpecialtyAward = getMarketplaceFilledSlotSummary({
  bids: [{
    vendor_user_id: 'existing-specialty-vendor', bid_status: 'AWARDED',
    awarded_coverage: 'VIP', awarded_specialty_services: [],
    specialty_services: ['DESSERTS'], archived_at: null,
  }],
  dessertRequirement: 1,
});
assert.strictEqual(
  existingSpecialtyAward.dessertSlotsFilled,
  1,
  'an existing award with an empty persisted specialty list falls back to its offered specialty'
);
assert.strictEqual(isMarketplaceVendorReductionBlocked({
  selectedRequirement: 1,
  ...getMarketplaceServiceRequirements(fullyCatered, 1),
  filled: fullyCateredFilled,
}), true);
const fullyCateredFiftyEach = getMarketplaceFilledSlotSummary({
  bids: [combinedBid], gaRequirement: 1, vipRequirement: 1,
});
assert.strictEqual(fullyCateredFiftyEach.minimumUniqueVendors, 1);
assert.strictEqual(fullyCateredFiftyEach.remainingTotalServiceSlots, 0);
assert.strictEqual(
  getMarketplaceFilledSlotSummary({
    bids: [{ ...combinedBid, archived_at: new Date(), bid_status: 'REVOKED' }],
    gaRequirement: 1, vipRequirement: 1,
  }).minimumUniqueVendors,
  0
);

console.log('marketplace participation helper tests passed');
