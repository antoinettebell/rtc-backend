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
assert.strictEqual(next.beginning_quantity, 10);
assert.strictEqual(next.current_quantity, 10);
assert.strictEqual(next.reorder_quantity, 0);
assert.strictEqual(buildChecklistItems('OPENING_CHECKLIST').length, 5);
assert.strictEqual(buildChecklistItems('CLOSING_CHECKLIST').length, 5);

console.log('operational compliance form tests passed');
