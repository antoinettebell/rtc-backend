const assert = require('assert');
const { getSearchTerms, scoreFoodTruckSearchResult } = require('./food-truck-search-helper');
const { FoodTruckModel } = require('../models');
const FoodTruckService = require('../v1/services/food-truck-service');

const trucks = [
  { name: 'Salad Station', menu: [{ name: 'Garden Salad', description: 'fresh greens' }] },
  { name: 'Round Da Corner', menu: [{ name: 'Cheeseburger', description: 'classic burger' }] },
  { name: 'Corner Cafe', menu: [{ name: 'Round Sandwich', description: '' }] },
];
const ranked = (query) => [...trucks].sort(
  (a, b) => scoreFoodTruckSearchResult(b, query) - scoreFoodTruckSearchResult(a, query),
);
assert.equal(ranked('Round Da Corner')[0].name, 'Round Da Corner');
assert.equal(ranked('  rOuNd   dA CORNER  ')[0].name, 'Round Da Corner');
assert.deepEqual(getSearchTerms('Da').broadTokens, []);
assert.equal(scoreFoodTruckSearchResult(trucks[0], 'Da'), 0);
assert(scoreFoodTruckSearchResult(trucks[1], 'Cheeseburger') > 0);
const limited = ranked('Round').slice(0, 1);
assert.equal(limited[0].name, 'Round Da Corner');

(async () => {
  const originalAggregate = FoodTruckModel.aggregate;
  let pipeline;
  FoodTruckModel.aggregate = async (value) => {
    pipeline = value;
    return [{ data: [], total: 0 }];
  };
  try {
    await FoodTruckService.getWithFiltersNew(
      null, null, null, null, null, 7, 1, 'Round Da Corner', null, null, null
    );
  } finally {
    FoodTruckModel.aggregate = originalAggregate;
  }
  assert.deepEqual(pipeline[0], { $match: { inactive: false, verified: true } });
  const relevanceIndex = pipeline.findIndex((stage) => stage.$sort?.searchScore === -1);
  const limitIndex = pipeline.findIndex((stage) => stage.$facet?.data?.some((item) => item.$limit === 7));
  assert(relevanceIndex > -1 && limitIndex > relevanceIndex);
  const eligibilityMatch = pipeline.find((stage) => stage.$match?.['menu.0']);
  assert.deepEqual(eligibilityMatch.$match['menu.0'], { $exists: true });
  assert.equal(eligibilityMatch.$match['menu.available'], true);
  console.log('Food-truck search relevance tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
