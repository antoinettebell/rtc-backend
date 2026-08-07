const assert = require('assert');
const importer = require('./menu-csv-import-service');

const sides = importer.parseComboSides({
  _rowNumber: 2,
  itemType: 'COMBO',
  comboSideOptions: 'Fries|Onion Rings|Fried Okra',
  comboSideCosts: 'Onion Rings:2.00|Fried Okra:2.00',
  comboSidesPerOrder: '1',
});

assert.deepStrictEqual(sides.comboSideOptions, [
  'Fries',
  'Onion Rings',
  'Fried Okra',
]);
assert.deepStrictEqual(sides.comboSideOptionCosts, [
  { name: 'Fries', hasCost: false, cost: 0 },
  { name: 'Onion Rings', hasCost: true, cost: 2 },
  { name: 'Fried Okra', hasCost: true, cost: 2 },
]);

const flavors = importer.parseFlavors({
  _rowNumber: 2,
  hasFlavors: 'TRUE',
  flavorLabel: 'Wing Sauce',
  flavors: 'BBQ|Hot Honey',
  flavorCosts: '',
  flavorsPerOrder: '1',
});

assert.strictEqual(flavors.flavorLabel, 'Wing Sauce');

const legacyFlavors = importer.parseFlavors({
  _rowNumber: 3,
  hasFlavors: 'TRUE',
  flavors: 'Mild|Hot',
  flavorsPerOrder: '1',
});

assert.strictEqual(legacyFlavors.flavorLabel, 'Flavor');
console.log('menu CSV import compatibility tests passed');
