const assert = require('node:assert/strict');
const {
  resolveRequestedComboSelections,
} = require('./combo-order-selection-helper');

const configuredItems = [
  {
    menuItem: { _id: 'egg-roll', name: 'Vegetable Egg Roll' },
    qty: 2,
    isAddOn: false,
  },
  {
    menuItem: { _id: 'loaded-rice', name: 'Loaded Fried Rice' },
    qty: 1,
    isAddOn: true,
  },
];

const legacySelections = resolveRequestedComboSelections(configuredItems, [
  { comboMenuItemId: 'egg-roll', qty: 2 },
  { comboMenuItemId: 'loaded-rice', qty: 1 },
]);
assert.equal(legacySelections.filter((item) => !item.isAddOn).length, 1);
assert.equal(legacySelections.filter((item) => item.isAddOn).length, 1);

const typedSelections = resolveRequestedComboSelections(configuredItems, [
  { comboMenuItemId: 'egg-roll', qty: 2, isAddOn: false },
  { comboMenuItemId: 'loaded-rice', qty: 1, isAddOn: true },
]);
assert.equal(typedSelections[0].configuredItem.qty, 2);
assert.equal(typedSelections[1].isAddOn, true);

const mismatchedType = resolveRequestedComboSelections(configuredItems, [
  { comboMenuItemId: 'egg-roll', isAddOn: true },
]);
assert.equal(mismatchedType[0].configuredItem, null);

console.log('combo order selection classification tests passed');
