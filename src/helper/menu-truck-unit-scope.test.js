const assert = require('node:assert/strict');
const {
  MENU_TRUCK_SCOPE,
  normalizeMenuTruckScope,
  isMenuItemAvailableForTruck,
  assertReferencedItemCoversParent,
  isMenuTreeAvailableForTruck,
} = require('./menu-truck-unit-scope');

const foodTruck = {
  truck_units: [
    { _id: 'truck-1', name: 'Truck One', is_primary: true },
    { _id: 'truck-2', name: 'Truck Two' },
    { _id: 'truck-old', name: 'Old Truck', is_archived: true },
  ],
};

assert.deepEqual(
  normalizeMenuTruckScope({
    truckServiceScope: MENU_TRUCK_SCOPE.ALL,
    truckUnitIds: ['truck-1'],
    foodTruck,
    requireExplicit: true,
  }),
  { truckServiceScope: MENU_TRUCK_SCOPE.ALL, truckUnitIds: [] }
);
assert.deepEqual(
  normalizeMenuTruckScope({
    truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
    truckUnitIds: ['truck-2'],
    foodTruck,
    requireExplicit: true,
  }),
  { truckServiceScope: MENU_TRUCK_SCOPE.SELECTED, truckUnitIds: ['truck-2'] }
);
assert.equal(
  isMenuItemAvailableForTruck({}, 'truck-1', foodTruck),
  true,
  'legacy items default to the primary truck'
);
assert.equal(isMenuItemAvailableForTruck({}, 'truck-2', foodTruck), false);
assert.equal(
  isMenuItemAvailableForTruck(
    { truckServiceScope: MENU_TRUCK_SCOPE.ALL },
    'truck-2',
    foodTruck
  ),
  true
);
assert.throws(
  () => normalizeMenuTruckScope({
    truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
    truckUnitIds: ['truck-old'],
    foodTruck,
    requireExplicit: true,
  }),
  /inactive or unrelated/
);
assert.equal(
  isMenuTreeAvailableForTruck({
    truckServiceScope: MENU_TRUCK_SCOPE.ALL,
    subItem: [{
      menuItem: {
        truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
        truckUnitIds: ['truck-1'],
      },
    }],
  }, 'truck-2', foodTruck),
  false,
  'a combo is hidden when a child is unavailable on the selected truck'
);
assert.equal(
  isMenuTreeAvailableForTruck({
    truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
    truckUnitIds: ['truck-2'],
    bogoItems: [{
      itemId: { truckServiceScope: MENU_TRUCK_SCOPE.ALL },
      isSameItem: false,
    }],
  }, 'truck-2', foodTruck),
  true,
  'an all-trucks BOGO reward is valid for a truck-scoped parent'
);
assert.throws(
  () => assertReferencedItemCoversParent({
    parent: { name: 'Combo', truckServiceScope: MENU_TRUCK_SCOPE.ALL },
    child: {
      name: 'Truck One Side',
      truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
      truckUnitIds: ['truck-1'],
    },
    foodTruck,
    relationLabel: 'Combo item',
  }),
  /not available on every food truck/
);

console.log('menu truck unit scope tests passed');
