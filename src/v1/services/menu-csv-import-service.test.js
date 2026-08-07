const assert = require('assert');
const { Types } = require('mongoose');
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

const individualId = new Types.ObjectId();
const burgerId = new Types.ObjectId();
const referenceRows = [
  { _rowNumber: 2, name: 'Lunch Combo', itemType: 'COMBO', comboItemNames: 'Burger|Cheeseburger', comboItemQuantities: '2|3' },
  { _rowNumber: 3, name: 'Burger Deal', itemType: 'INDIVIDUAL', discountType: 'BOGO', bogoItemNames: 'Cheeseburger' },
  { _rowNumber: 4, name: 'Cheeseburger', itemType: 'INDIVIDUAL' },
];

assert.deepStrictEqual(importer.orderRecordsForReferences(referenceRows).map((row) => row._rowNumber), [4, 3, 2]);
assert.throws(
  () => importer.validateUniqueRecordNames([{ _rowNumber: 2, name: 'Cheeseburger' }, { _rowNumber: 8, name: ' cheeseburger ' }]),
  /Duplicate menu item names.*rows 2, 8/
);
assert.deepStrictEqual(importer.buildBogoDiscountRules({ discountType: 'BOGO' }), { buyQty: 1, getQty: 1, discount: 1, repeatable: true });
assert.deepStrictEqual(importer.buildBogoDiscountRules({ discountType: 'BOGOHO' }), { buyQty: 1, getQty: 1, discount: 0.5, repeatable: true });

(async () => {
  const nameMap = new Map([['cheeseburger', individualId], ['burger', burgerId]]);
  const comboItems = await importer.resolveComboSubItems(referenceRows[0], new Types.ObjectId(), nameMap);
  assert.deepStrictEqual(comboItems.map((item) => item.qty), [2, 3]);
  assert.equal(comboItems[1].menuItem.toString(), individualId.toString());

  for (const discountType of ['BOGO', 'BOGOHO']) {
    const bogoItems = await importer.resolveBogoItems({ ...referenceRows[1], discountType }, new Types.ObjectId(), nameMap);
    assert.equal(bogoItems[0].itemId.toString(), individualId.toString());
  }

  const sameItem = await importer.resolveBogoItems({ _rowNumber: 5, name: 'Cheeseburger', bogoItemNames: ' cheeseburger ' }, new Types.ObjectId(), new Map());
  assert.deepStrictEqual(sameItem, [{ itemId: null, qty: 1, isSameItem: true }]);

  const { MenuItemModel } = require('../../models');
  const originalFindOne = MenuItemModel.findOne;
  const originalFind = MenuItemModel.find;
  MenuItemModel.findOne = () => ({ select: async () => null });
  try {
    await assert.rejects(
      importer.resolveBogoItems({ _rowNumber: 9, name: 'Deal', bogoItemNames: 'Missing Item' }, new Types.ObjectId(), new Map()),
      /BOGO item "Missing Item" was not found/
    );
    const legacyId = new Types.ObjectId();
    MenuItemModel.find = () => ({ select: async () => [{ _id: legacyId }] });
    const legacyBogo = await importer.resolveBogoItems(
      { _rowNumber: 10, bogoItemIds: legacyId.toString() },
      new Types.ObjectId(),
      new Map()
    );
    assert.equal(legacyBogo[0].itemId.toString(), legacyId.toString());
  } finally {
    MenuItemModel.findOne = originalFindOne;
    MenuItemModel.find = originalFind;
  }

  const originalMethods = {
    validateVendor: importer.validateVendor,
    getVendorCapabilities: importer.getVendorCapabilities,
    resolveImageUrls: importer.resolveImageUrls,
    getOrCreateMenuCategory: importer.getOrCreateMenuCategory,
    buildMenuItemUpdateFilter: importer.buildMenuItemUpdateFilter,
    validateComboPromotionNesting: importer.validateComboPromotionNesting,
    updateOne: MenuItemModel.updateOne,
    findOne: MenuItemModel.findOne,
  };
  const savedByName = new Map();
  const writtenItems = [];
  importer.validateVendor = async () => true;
  importer.getVendorCapabilities = async () => ({ newDishHighlight: true });
  importer.resolveImageUrls = async () => [];
  importer.getOrCreateMenuCategory = async () => ({ categoryId: new Types.ObjectId(), created: false });
  importer.buildMenuItemUpdateFilter = async (row, menuItem, userId) => ({ name: menuItem.name, userId });
  importer.validateComboPromotionNesting = async () => true;
  MenuItemModel.updateOne = async (filter, update) => {
    const saved = { ...update.$set, _id: new Types.ObjectId() };
    savedByName.set(importer.normalizeMenuItemName(saved.name), saved);
    writtenItems.push(saved);
    return { upsertedCount: 1 };
  };
  MenuItemModel.findOne = (filter) => ({
    select: async () => savedByName.get(importer.normalizeMenuItemName(filter.name)) || null,
  });
  try {
    const csv = [
      'name,itemType,hasDiscount,discountType,bogoItemNames,comboItemNames,comboItemQuantities,price',
      'Burger BOGO,INDIVIDUAL,TRUE,BOGO,Cheeseburger,,,10',
      'Lunch Combo,COMBO,FALSE,,,Cheeseburger|Fries,2|1,18',
      'Cheeseburger,INDIVIDUAL,FALSE,,,,,10',
      'Fries,INDIVIDUAL,FALSE,,,,,4',
    ].join('\n');
    const summary = await importer.importFromCsv({ csvText: csv, vendorUserId: new Types.ObjectId().toString() });
    assert.equal(summary.failedCount, 0);
    assert.deepStrictEqual(writtenItems.map((item) => item.name), ['Cheeseburger', 'Fries', 'Burger BOGO', 'Lunch Combo']);
    assert.equal(writtenItems[2].bogoItems[0].itemId.toString(), savedByName.get('cheeseburger')._id.toString());
    assert.deepStrictEqual(writtenItems[3].subItem.map((item) => item.qty), [2, 1]);
  } finally {
    Object.assign(importer, {
      validateVendor: originalMethods.validateVendor,
      getVendorCapabilities: originalMethods.getVendorCapabilities,
      resolveImageUrls: originalMethods.resolveImageUrls,
      getOrCreateMenuCategory: originalMethods.getOrCreateMenuCategory,
      buildMenuItemUpdateFilter: originalMethods.buildMenuItemUpdateFilter,
      validateComboPromotionNesting: originalMethods.validateComboPromotionNesting,
    });
    MenuItemModel.updateOne = originalMethods.updateOne;
    MenuItemModel.findOne = originalMethods.findOne;
  }

  console.log('menu CSV reference resolution tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

console.log('menu CSV import compatibility tests passed');
