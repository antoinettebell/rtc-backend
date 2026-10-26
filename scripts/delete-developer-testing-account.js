/*
 * Deletes only the reviewed Development Testing food-vendor account and truck.
 *
 * This script refuses to run if the exact account/truck pair has changed or if
 * any order, payment, or marketplace history exists. It does not delete S3
 * objects. Run without flags for a validation-only dry run.
 *
 * Dry run: node scripts/delete-developer-testing-account.js
 * Apply:   node scripts/delete-developer-testing-account.js --apply --confirm=DELETE_DEVELOPER_TESTING_ACCOUNT
 */
require('dotenv').config({ path: './.env' });

const mongoose = require('mongoose');
const { UserModel, FoodTruckModel } = require('../src/models');

const CONFIRMATION = 'DELETE_DEVELOPER_TESTING_ACCOUNT';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply') && args.has(`--confirm=${CONFIRMATION}`);

const TARGET = Object.freeze({
  userId: '6adfc406c152f940714d8fb3',
  foodTruckId: '6adfc407c152f940714d8fb6',
  email: 'developer@roundthecornerapp.com',
  name: 'Developer Testing',
  userType: 'VENDOR',
  vendorSubtype: 'FOOD_VENDOR',
  foodTruckName: 'Doggy Hotdogs',
});

const normalizedName = (user) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim().replace(/\s+/g, ' ');

const userId = new mongoose.Types.ObjectId(TARGET.userId);
const foodTruckId = new mongoose.Types.ObjectId(TARGET.foodTruckId);

const cleanupCollections = [
  ['addresses', { userId }],
  ['bank-details', { userId }],
  ['menu-categories', { userId }],
  ['menu-items', { userId }],
  ['vendor_employees', { food_truck_id: foodTruckId }],
  ['employee_sessions', { food_truck_id: foodTruckId }],
  ['employee_refund_cancel_requests', { food_truck_id: foodTruckId }],
  ['employee_item_availability_audits', { food_truck_id: foodTruckId }],
  ['vendor_compliance_documents', { food_truck_id: foodTruckId }],
  ['vendor_compliance_provider_verifications', { food_truck_id: foodTruckId }],
  ['vendor_compliance_w9_envelopes', { food_truck_id: foodTruckId }],
  ['vendor_compliance_audits', { food_truck_id: foodTruckId }],
  ['operational_compliance_forms', { food_truck_id: foodTruckId }],
  ['operational_notifications', { food_truck_id: foodTruckId }],
  ['tap_to_pay_terminals', { food_truck_id: foodTruckId }],
  ['tap_to_pay_terminal_events', { food_truck_id: foodTruckId }],
  ['tap-to-pay-payment-attempts', { food_truck_id: foodTruckId }],
  ['favorite-food-trucks', { foodTruckId }],
  ['reviews', { foodTruckId }],
  ['review-tokens', { foodTruckId }],
];

const blockerCollections = [
  ['orders', { $or: [{ foodTruckId }, { food_truck_id: foodTruckId }, { vendor_user_id: userId }] }],
  ['payment-logs', { userId }],
  ['marketplace-applications', { $or: [{ vendor_user_id: userId }, { food_truck_id: foodTruckId }] }],
  ['marketplace-bids', { $or: [{ vendor_user_id: userId }, { food_truck_id: foodTruckId }] }],
  ['event-vendor-applications', { vendor_user_id: userId }],
];

const verifyTarget = async (session) => {
  const user = await UserModel.findById(userId)
    .select('_id email firstName lastName userType vendorSubtype')
    .session(session)
    .lean();
  if (
    !user ||
    user.email !== TARGET.email ||
    normalizedName(user) !== TARGET.name ||
    user.userType !== TARGET.userType ||
    user.vendorSubtype !== TARGET.vendorSubtype
  ) {
    throw new Error('Account identity no longer matches the reviewed target. No data was changed.');
  }

  const foodTrucks = await FoodTruckModel.find({ userId })
    .select('_id name userId')
    .session(session)
    .lean();
  if (
    foodTrucks.length !== 1 ||
    String(foodTrucks[0]._id) !== TARGET.foodTruckId ||
    foodTrucks[0].name !== TARGET.foodTruckName
  ) {
    throw new Error('Food-truck target no longer matches the reviewed account. No data was changed.');
  }
};

const countBlockers = async (session) => {
  const results = [];
  for (const [collection, filter] of blockerCollections) {
    const records = await mongoose.connection.db.collection(collection).countDocuments(filter, { session });
    results.push({ collection, records });
  }
  return results;
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured. No database connection was attempted.');
  await mongoose.connect(process.env.MONGO_URI);

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      await verifyTarget(session);
      const blockers = await countBlockers(session);
      if (blockers.some((blocker) => blocker.records > 0)) {
        console.table(blockers);
        throw new Error('Transaction or marketplace history was found. No data was changed.');
      }

      if (!apply) {
        result = { dryRun: true, blockers };
        return;
      }

      const deleted = [];
      for (const [collection, filter] of cleanupCollections) {
        const response = await mongoose.connection.db.collection(collection).deleteMany(filter, { session });
        deleted.push({ collection, records: response.deletedCount });
      }
      const foodTruck = await FoodTruckModel.deleteOne({ _id: foodTruckId, userId }, { session });
      const user = await UserModel.deleteOne({ _id: userId, email: TARGET.email }, { session });
      if (foodTruck.deletedCount !== 1 || user.deletedCount !== 1) {
        throw new Error('The account or food-truck delete count was unexpected. Transaction rolled back.');
      }
      result = { dryRun: false, deleted };
    });
  } finally {
    await session.endSession();
  }

  if (result?.dryRun) {
    console.log('DRY RUN PASSED — exact account/truck validated and no blockers found.');
    console.log(`To apply, rerun with: --apply --confirm=${CONFIRMATION}`);
    return;
  }

  console.log('DELETE COMPLETE — only Developer Testing and Doggy Hotdogs were removed.');
  console.table(result.deleted);
  console.table([
    { collection: 'food-trucks', records: 1 },
    { collection: 'users', records: 1 },
  ]);
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(`DEVELOPER_TESTING_ACCOUNT_DELETE_ERROR=${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
