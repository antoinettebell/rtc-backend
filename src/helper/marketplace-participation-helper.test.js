const assert = require('assert');
const {
  getAllowedBidCoverages,
  getMarketplaceBudgetGuestCount,
} = require('./marketplace-participation-helper');

const fullyCatered = {
  fully_catered_event: true,
  number_of_guests: 150,
  vip_guest_count: 50,
};
assert.strictEqual(getMarketplaceBudgetGuestCount(fullyCatered), 200);
assert.deepStrictEqual(getAllowedBidCoverages(fullyCatered), ['REGULAR', 'VIP', 'BOTH']);

const vipWithGaSales = {
  catered_vip_section_enabled: true,
  ga_food_sales_allowed: true,
  number_of_guests: 150,
  vip_guest_count: 50,
};
assert.strictEqual(getMarketplaceBudgetGuestCount(vipWithGaSales), 50);
assert.deepStrictEqual(getAllowedBidCoverages(vipWithGaSales), ['VIP', 'BOTH']);

assert.deepStrictEqual(
  getAllowedBidCoverages({ ...vipWithGaSales, ga_food_sales_allowed: false }),
  ['VIP']
);

const vendorPaidGa = { number_of_guests: 150, vip_guest_count: 0 };
assert.strictEqual(getMarketplaceBudgetGuestCount(vendorPaidGa), 150);
assert.deepStrictEqual(getAllowedBidCoverages(vendorPaidGa), ['REGULAR']);

console.log('marketplace participation helper tests passed');
