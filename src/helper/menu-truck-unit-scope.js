const MENU_TRUCK_SCOPE = Object.freeze({
  ALL: 'ALL_ACTIVE_TRUCKS',
  SELECTED: 'SELECTED_TRUCKS',
});

const idString = (value) => String(value?._id || value || '').trim();

const activeTruckUnits = (foodTruck) =>
  (Array.isArray(foodTruck?.truck_units) ? foodTruck.truck_units : []).filter(
    (unit) => !unit?.is_archived && idString(unit)
  );

const primaryTruckUnitId = (foodTruck) => {
  const units = activeTruckUnits(foodTruck);
  return idString(units.find((unit) => unit?.is_primary) || units[0]) || null;
};

const normalizeMenuTruckScope = ({
  truckServiceScope,
  truckUnitIds,
  foodTruck,
  requireExplicit = false,
}) => {
  const units = activeTruckUnits(foodTruck);
  const activeIds = new Set(units.map(idString));
  const scope = String(truckServiceScope || '').trim().toUpperCase();

  if (!units.length) {
    const error = new Error('Add an active food truck before assigning menu items.');
    error.code = 409;
    throw error;
  }

  if (!scope && requireExplicit) {
    const error = new Error('Food Truck availability is required.');
    error.code = 400;
    throw error;
  }

  if (!scope) {
    const primaryId = primaryTruckUnitId(foodTruck);
    return {
      truckServiceScope: MENU_TRUCK_SCOPE.SELECTED,
      truckUnitIds: primaryId ? [primaryId] : [],
    };
  }

  if (scope === MENU_TRUCK_SCOPE.ALL) {
    return { truckServiceScope: MENU_TRUCK_SCOPE.ALL, truckUnitIds: [] };
  }

  if (scope !== MENU_TRUCK_SCOPE.SELECTED) {
    const error = new Error('Food Truck availability must be All Food Trucks or selected active trucks.');
    error.code = 400;
    throw error;
  }

  const ids = [...new Set((Array.isArray(truckUnitIds) ? truckUnitIds : [])
    .map(idString)
    .filter(Boolean))];
  if (!ids.length) {
    const error = new Error('Select at least one active food truck.');
    error.code = 400;
    throw error;
  }

  const invalidIds = ids.filter((id) => !activeIds.has(id));
  if (invalidIds.length) {
    const error = new Error('Food Truck availability contains an inactive or unrelated truck.');
    error.code = 400;
    throw error;
  }

  return { truckServiceScope: MENU_TRUCK_SCOPE.SELECTED, truckUnitIds: ids };
};

const effectiveMenuTruckScope = (menuItem, foodTruck) =>
  normalizeMenuTruckScope({
    truckServiceScope: menuItem?.truckServiceScope,
    truckUnitIds: menuItem?.truckUnitIds,
    foodTruck,
  });

const isMenuItemAvailableForTruck = (menuItem, truckUnitId, foodTruck) => {
  const targetId = idString(truckUnitId);
  if (!targetId) return false;
  const scope = effectiveMenuTruckScope(menuItem, foodTruck);
  return scope.truckServiceScope === MENU_TRUCK_SCOPE.ALL ||
    scope.truckUnitIds.some((id) => idString(id) === targetId);
};

const scopeCoversScope = (childScope, parentScope) => {
  if (childScope.truckServiceScope === MENU_TRUCK_SCOPE.ALL) return true;
  if (parentScope.truckServiceScope === MENU_TRUCK_SCOPE.ALL) return false;
  const childIds = new Set(childScope.truckUnitIds.map(idString));
  return parentScope.truckUnitIds.every((id) => childIds.has(idString(id)));
};

const assertReferencedItemCoversParent = ({
  parent,
  child,
  foodTruck,
  relationLabel,
}) => {
  const parentScope = effectiveMenuTruckScope(parent, foodTruck);
  const childScope = effectiveMenuTruckScope(child, foodTruck);
  if (scopeCoversScope(childScope, parentScope)) return;

  const error = new Error(
    `${relationLabel || 'Referenced item'} "${child?.name || 'Menu item'}" is not available on every food truck assigned to "${parent?.name || 'this item'}".`
  );
  error.code = 409;
  throw error;
};

const isMenuTreeAvailableForTruck = (menuItem, truckUnitId, foodTruck) => {
  if (!isMenuItemAvailableForTruck(menuItem, truckUnitId, foodTruck)) return false;

  const comboChildren = (Array.isArray(menuItem?.subItem) ? menuItem.subItem : [])
    .map((entry) =>
      entry?.menuItem && typeof entry.menuItem === 'object'
        ? entry.menuItem
        : entry?.truckServiceScope || entry?.name
          ? entry
          : null
    )
    .filter((entry) => entry && typeof entry === 'object');
  const bogoChildren = (Array.isArray(menuItem?.bogoItems) ? menuItem.bogoItems : [])
    .filter((entry) => !entry?.isSameItem)
    .map((entry) =>
      entry?.itemId && typeof entry.itemId === 'object'
        ? entry.itemId
        : entry?.truckServiceScope || entry?.name
          ? entry
          : null
    )
    .filter((entry) => entry && typeof entry === 'object');

  return [...comboChildren, ...bogoChildren].every((child) =>
    isMenuItemAvailableForTruck(child, truckUnitId, foodTruck)
  );
};

module.exports = {
  MENU_TRUCK_SCOPE,
  activeTruckUnits,
  primaryTruckUnitId,
  normalizeMenuTruckScope,
  effectiveMenuTruckScope,
  isMenuItemAvailableForTruck,
  scopeCoversScope,
  assertReferencedItemCoversParent,
  isMenuTreeAvailableForTruck,
};
