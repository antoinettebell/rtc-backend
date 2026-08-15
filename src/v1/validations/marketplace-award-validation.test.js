const assert = require('assert');
const MarketplaceValidation = require('./marketplace-validation');

const validate = (body) => MarketplaceValidation.awardBids.body.validate(body, {
  abortEarly: false,
});

const mixedBatch = validate({
  bid_ids: ['bid-1'],
  food_application_ids: [],
  event_vendor_application_ids: ['event-application-1'],
  award_selections: [{ bid_id: 'bid-1', award_coverage: 'REGULAR' }],
});
assert.equal(mixedBatch.error, undefined, 'unused award ID arrays may be empty');

const foodApplicationOnly = validate({
  bid_ids: [],
  food_application_ids: ['food-application-1'],
  event_vendor_application_ids: [],
  award_selections: [],
});
assert.equal(foodApplicationOnly.error, undefined, 'a Food application-only batch is valid');

const emptyBatch = validate({
  bid_ids: [],
  food_application_ids: [],
  event_vendor_application_ids: [],
  award_selections: [],
});
assert.ok(emptyBatch.error, 'at least one submission remains required');

console.log('marketplace award validation tests passed');
