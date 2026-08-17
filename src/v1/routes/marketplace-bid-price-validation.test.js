const assert = require('assert');
const MarketplaceValidation = require('../validations/marketplace-validation');

const validate = (body) => MarketplaceValidation.submitBid.body.validate(body);

assert.equal(validate({ bid_status: 'DRAFT', price_per_guest: null }).error, undefined);
assert.equal(validate({ bid_status: 'DRAFT' }).error, undefined);
assert.match(
  validate({ bid_status: 'PENDING_SIGNATURE', price_per_guest: null }).error?.message || '',
  /price_per_guest/
);
assert.match(
  validate({ bid_status: 'SUBMITTED', price_per_guest: 0 }).error?.message || '',
  /price_per_guest/
);
assert.equal(
  validate({ bid_status: 'PENDING_SIGNATURE', price_per_guest: 15 }).error,
  undefined
);
assert.equal(
  validate({ bid_status: 'SUBMITTED', price_per_guest: 15 }).error,
  undefined
);
assert.equal(
  validate({ bid_status: 'SUBMITTED', price_per_guest: 15, average_price_per_meal: null }).error,
  undefined,
  'Average Price Per Meal remains optional'
);

console.log('marketplace bid price validation tests passed');
