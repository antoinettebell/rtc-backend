const assert = require('assert');
const { buildCounts } = require('./event-vendor-photo-counter');

const first = buildCounts([
  { _id: 'ARTISANS_CRAFTERS', count: 10 },
  { _id: 'APPAREL_ACCESSORIES', count: 10 },
  { _id: 'COMMERCIAL_RETAIL', count: 10 },
  { _id: 'LOCAL_MAKERS_SPECIALTY', count: 10 },
]);
const second = buildCounts(Object.entries(first).map(([_id, count]) => ({ _id, count })));
assert.deepStrictEqual(second, first, 'repeated reconciliation derives the same counters without incrementing');
assert.equal(Object.values(first).reduce((sum, count) => sum + count, 0), 40);
console.log('Marketplace Vendor repository counter reconciliation tests passed');
