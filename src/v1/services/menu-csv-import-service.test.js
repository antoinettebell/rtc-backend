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
  assert.equal(bogoItems[0].itemId.toString(), individualId.toString());
  assert.equal(bogoItems[0].qty, 1);
  assert.equal(bogoItems[0].isSameItem, false);
  console.log('menu CSV reference resolution tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
