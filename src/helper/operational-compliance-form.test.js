const assert = require('assert');
const {
  buildChecklistItems,
  buildNextInventoryItems,
  normalizeInventoryItems,
} = require('./operational-compliance-form');

const [normalized] = normalizeInventoryItems([
  { item_name: 'Bread', current_quantity: 3, max_quantity: 10 },
]);
assert.strictEqual(normalized.reorder_quantity, 7);

const [next] = buildNextInventoryItems([normalized]);
assert.strictEqual(next.beginning_quantity, 3);
assert.strictEqual(next.current_quantity, 3);
assert.strictEqual(next.reorder_quantity, 7);
assert.strictEqual(next.use_by_date, null);
const [zero] = normalizeInventoryItems([
  { item_name: 'Sold out bread', beginning_quantity: 0, current_quantity: 0, max_quantity: 10 },
]);
assert.strictEqual(zero.beginning_quantity, 0);
assert.strictEqual(zero.current_quantity, 0);
assert.strictEqual(zero.reorder_quantity, 10);
assert.strictEqual(buildChecklistItems('OPENING_CHECKLIST').length, 5);
assert.strictEqual(buildChecklistItems('CLOSING_CHECKLIST').length, 5);

console.log('operational compliance form tests passed');
