const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { buildMenuTruckScopeMigrationPlan } = require('./migrate-menu-truck-scopes');

const userId = new mongoose.Types.ObjectId();
const itemId = new mongoose.Types.ObjectId();
const primaryId = new mongoose.Types.ObjectId();
const secondaryId = new mongoose.Types.ObjectId();

const plan = buildMenuTruckScopeMigrationPlan({
  menuItems: [{ _id: itemId, userId }],
  foodTrucks: [{
    userId,
    truck_units: [
      { _id: secondaryId, is_archived: false },
      { _id: primaryId, is_primary: true, is_archived: false },
    ],
  }],
});

assert.equal(plan.updates.length, 1);
assert.equal(plan.skipped.length, 0);
assert.equal(plan.updates[0].updateOne.update.$set.truckServiceScope, 'SELECTED_TRUCKS');
assert.deepEqual(
  plan.updates[0].updateOne.update.$set.truckUnitIds.map(String),
  [String(primaryId)]
);

const missingPrimary = buildMenuTruckScopeMigrationPlan({
  menuItems: [{ _id: itemId, userId }],
  foodTrucks: [{ userId, truck_units: [{ _id: primaryId, is_archived: true }] }],
});
assert.equal(missingPrimary.updates.length, 0);
assert.equal(missingPrimary.skipped[0].reason, 'PRIMARY_TRUCK_UNIT_UNAVAILABLE');

console.log('menu truck scope migration tests passed');
