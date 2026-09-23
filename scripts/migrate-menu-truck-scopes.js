require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const { FoodTruckModel, MenuItemModel } = require('../src/models');
const { primaryTruckUnitId } = require('../src/helper/menu-truck-unit-scope');

const missingScopeFilter = {
  deletedAt: null,
  $or: [
    { truckServiceScope: { $exists: false } },
    { truckServiceScope: null },
    { truckServiceScope: '' },
  ],
};

const buildMenuTruckScopeMigrationPlan = ({ menuItems, foodTrucks }) => {
  const foodTruckByUserId = new Map(
    foodTrucks.map((foodTruck) => [String(foodTruck.userId), foodTruck])
  );
  const updates = [];
  const skipped = [];

  for (const item of menuItems) {
    const truckUnitId = primaryTruckUnitId(foodTruckByUserId.get(String(item.userId)));
    if (!truckUnitId) {
      skipped.push({ menuItemId: String(item._id), reason: 'PRIMARY_TRUCK_UNIT_UNAVAILABLE' });
      continue;
    }
    updates.push({
      updateOne: {
        filter: { _id: item._id, ...missingScopeFilter },
        update: {
          $set: {
            truckServiceScope: 'SELECTED_TRUCKS',
            truckUnitIds: [new mongoose.Types.ObjectId(truckUnitId)],
          },
        },
      },
    });
  }
  return { updates, skipped };
};

const run = async ({ apply = process.argv.includes('--apply') } = {}) => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  const menuItems = await MenuItemModel.find(missingScopeFilter)
    .select('_id userId')
    .lean();
  const userIds = [...new Set(menuItems.map((item) => String(item.userId)))]
    .filter(mongoose.Types.ObjectId.isValid)
    .map((id) => new mongoose.Types.ObjectId(id));
  const foodTrucks = userIds.length
    ? await FoodTruckModel.find({ userId: { $in: userIds } })
      .select('userId truck_units')
      .lean()
    : [];
  const plan = buildMenuTruckScopeMigrationPlan({ menuItems, foodTrucks });
  let modifiedCount = 0;
  if (apply && plan.updates.length) {
    const result = await MenuItemModel.bulkWrite(plan.updates, { ordered: false });
    modifiedCount = result.modifiedCount;
  }
  console.log('Menu truck scope migration', {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    candidates: menuItems.length,
    planned: plan.updates.length,
    modified: modifiedCount,
    skipped: plan.skipped.length,
  });
  return { ...plan, modifiedCount, apply };
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Menu truck scope migration failed', { message: error.message });
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

module.exports = { missingScopeFilter, buildMenuTruckScopeMigrationPlan, run };
