const assert = require('assert');
const { Types } = require('mongoose');
const menuCsvImportService = require('./menu-csv-import-service');

const individualId = new Types.ObjectId();
const burgerId = new Types.ObjectId();
const rows = [
  {
    _rowNumber: 2,
    name: 'Lunch Combo',
    itemType: 'COMBO',
    comboItemNames: 'Burger|Fries',
    comboItemQuantities: '2|1',
  },
  {
    _rowNumber: 3,
    name: 'Burger Deal',
    itemType: 'INDIVIDUAL',
    bogoItemNames: 'Fries',
  },
  {
    _rowNumber: 4,
    name: 'Fries',
    itemType: 'INDIVIDUAL',
  },
];

assert.deepStrictEqual(
  menuCsvImportService
    .orderRecordsForReferences(rows)
    .map((row) => row._rowNumber),
  [4, 3, 2],
  'individual items must be imported before BOGO and combo rows'
);

assert.throws(
  () =>
    menuCsvImportService.validateUniqueRecordNames([
      { _rowNumber: 2, name: 'Fries' },
      { _rowNumber: 8, name: ' fries ' },
    ]),
  /Duplicate menu item names.*rows 2, 8/,
  'duplicate names should be rejected case-insensitively'
);

assert.deepStrictEqual(
  menuCsvImportService.buildBogoDiscountRules({ discountType: 'BOGOHO' }),
  { buyQty: 1, getQty: 1, discount: 0.5, repeatable: true }
);
assert.deepStrictEqual(
  menuCsvImportService.buildBogoDiscountRules({ discountType: 'BOGO' }),
  { buyQty: 1, getQty: 1, discount: 1, repeatable: true }
);

const sides = menuCsvImportService.parseComboSides({
  _rowNumber: 6,
  itemType: 'COMBO',
  comboSideOptions: 'Fries|Onion Rings|Fried Okra',
  comboSideCosts: 'Onion Rings:2.00|Fried Okra:2.00',
  comboSidesPerOrder: '1',
});
assert.deepStrictEqual(sides.comboSideOptionCosts, [
  { name: 'Fries', hasCost: false, cost: 0 },
  { name: 'Onion Rings', hasCost: true, cost: 2 },
  { name: 'Fried Okra', hasCost: true, cost: 2 },
]);

assert.deepStrictEqual(
  menuCsvImportService.parseComboItemQuantities({ _rowNumber: 6 }, 2),
  [1, 1],
  'older CSV files without combo quantities must remain compatible'
);

const labeledFlavors = menuCsvImportService.parseFlavors({
  _rowNumber: 7,
  hasFlavors: 'TRUE',
  flavorLabel: 'Wing Sauce',
  flavors: 'BBQ|Hot Honey',
  flavorsPerOrder: '1',
});
assert.equal(labeledFlavors.flavorLabel, 'Wing Sauce');

const legacyFlavors = menuCsvImportService.parseFlavors({
  _rowNumber: 8,
  hasFlavors: 'TRUE',
  flavors: 'Mild|Hot',
  flavorsPerOrder: '1',
});
assert.equal(legacyFlavors.flavorLabel, 'Flavor');

(async () => {
  const nameMap = new Map([
    ['fries', individualId],
    ['burger', burgerId],
  ]);
  const comboItems = await menuCsvImportService.resolveComboSubItems(
    rows[0],
    new Types.ObjectId(),
    nameMap
  );
  const bogoItems = await menuCsvImportService.resolveBogoItems(
    rows[1],
    new Types.ObjectId(),
    nameMap
  );

  assert.equal(comboItems[1].menuItem.toString(), individualId.toString());
  assert.equal(comboItems[0].qty, 2);
  assert.equal(comboItems[1].qty, 1);
  assert.equal(bogoItems[0].itemId.toString(), individualId.toString());
  assert.equal(bogoItems[0].qty, 1);
  assert.equal(bogoItems[0].isSameItem, false);

  assert.throws(
    () =>
      menuCsvImportService.parseComboItemQuantities(
        { _rowNumber: 9, comboItemQuantities: '1|1.5' },
        2
      ),
    /whole numbers between 1 and 99/
  );

  const sameItemReward = await menuCsvImportService.resolveBogoItems(
    {
      _rowNumber: 5,
      name: 'Family Combo',
      itemType: 'COMBO',
      bogoItemNames: 'Family Combo',
    },
    new Types.ObjectId(),
    new Map()
  );
  assert.equal(sameItemReward[0].itemId, null);
  assert.equal(sameItemReward[0].isSameItem, true);
  console.log('menu CSV reference resolution tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
