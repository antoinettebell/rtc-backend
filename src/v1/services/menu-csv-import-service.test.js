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

assert.deepStrictEqual(importer.parseComboItemQuantities({ _rowNumber: 6 }, 2), [1, 1]);
assert.deepStrictEqual(
  importer.parseComboItemQuantities({ _rowNumber: 6, comboItemQuantities: '2|3' }, 2),
  [2, 3]
);
['0', '-1', '1.5', 'abc', '100'].forEach((quantity) => {
  assert.throws(
    () => importer.parseComboItemQuantities({ _rowNumber: 9, comboItemQuantities: quantity }, 1),
    /whole numbers between 1 and 99/
  );
});

console.log('menu CSV import compatibility tests passed');
