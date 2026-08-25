const assert = require('assert');
const {
  calculateMarketplaceBidTotal,
  getMarketplaceBidTotal,
} = require('./marketplace-bid-total-helper');

assert.equal(calculateMarketplaceBidTotal({ full_bid_amount: 1250 }), 1250);
assert.equal(calculateMarketplaceBidTotal({
  full_bid_amount: 1250,
  specialty_services: ['DESSERTS', 'DRINKS'],
  dessert_bid_amount: 150,
  drinks_bid_amount: 100,
}), 1500);
assert.equal(calculateMarketplaceBidTotal({
  full_bid_amount: 0,
  specialty_services: ['DESSERTS', 'DRINKS'],
  dessert_bid_amount: 75,
  drinks_bid_amount: 50,
}), 125);
assert.equal(getMarketplaceBidTotal({
  full_bid_amount: 1250,
  specialty_services: ['DESSERTS'],
  dessert_bid_amount: 150,
}), 1400, 'historical bids calculate a safe total when the stored field is absent');
assert.equal(getMarketplaceBidTotal({ full_bid_amount: 1250, total_bid_amount: 1500 }), 1500);

console.log('marketplace bid total helper tests passed');
