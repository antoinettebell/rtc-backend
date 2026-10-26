/*
 * Read-only preview for the single newly-created Developer Testing account.
 *
 * This script cannot delete or update data. It identifies the account by its
 * email, name, vendor role, and its one expected food truck before showing a
 * dependency inventory for a separately reviewed delete operation.
 *
 * Run: node scripts/preview-developer-testing-account-delete.js
 */
require('dotenv').config({ path: './.env' });

const mongoose = require('mongoose');
const { UserModel, FoodTruckModel } = require('../src/models');

const TARGET = Object.freeze({
  email: 'developer@roundthecornerapp.com',
  name: 'Developer Testing',
  userType: 'VENDOR',
  vendorSubtype: 'FOOD_VENDOR',
  foodTruckName: 'Doggy Hotties',
});

const normalizedName = (user) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim().replace(/\s+/g, ' ');

const collectionCount = (name, filter) =>
  mongoose.connection.db.collection(name).countDocuments(filter);

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured. No database connection was attempted.');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const users = await UserModel.find({ email: TARGET.email })
    .select('_id email firstName lastName userType vendorSubtype createdAt')
    .lean();

  if (users.length !== 1) {
    throw new Error('Expected exactly one Developer Testing account. No data was changed.');
  }

  const user = users[0];
  if (
    normalizedName(user) !== TARGET.name ||
    user.userType !== TARGET.userType ||
    user.vendorSubtype !== TARGET.vendorSubtype
  ) {
    throw new Error('The account identity or role does not match the reviewed target. No data was changed.');
  }

  const foodTrucks = await FoodTruckModel.find({ userId: user._id })
    .select('_id name createdAt inactive')
    .lean();

  if (foodTrucks.length !== 1 || foodTrucks[0].name !== TARGET.foodTruckName) {
    console.log('\nFOOD TRUCKS OWNED BY THE MATCHED DEVELOPER TESTING ACCOUNT');
    console.table(foodTrucks.map((truck) => ({
      foodTruck: truck.name || '(blank)',
      foodTruckId: String(truck._id),
      inactive: Boolean(truck.inactive),
      createdAt: truck.createdAt || null,
    })));
    throw new Error('Expected exactly one Doggy Hotties food truck for this account. No data was changed.');
  }

  const foodTruck = foodTrucks[0];
  const userId = user._id;
  const foodTruckId = foodTruck._id;

  const [counts, blockers] = await Promise.all([
    Promise.all([
      collectionCount('address', { userId }),
      collectionCount('bank-details', { userId }),
      collectionCount('menu-categories', { userId }),
      collectionCount('menu-items', { userId }),
      collectionCount('vendor-employees', { food_truck_id: foodTruckId }),
      collectionCount('employee-sessions', { food_truck_id: foodTruckId }),
      collectionCount('employee-refund-cancel-requests', { food_truck_id: foodTruckId }),
      collectionCount('employee-item-availability-audits', { food_truck_id: foodTruckId }),
      collectionCount('vendor_compliance_documents', { food_truck_id: foodTruckId }),
      collectionCount('vendor_compliance_provider_verifications', { food_truck_id: foodTruckId }),
      collectionCount('vendor_compliance_w9_envelopes', { food_truck_id: foodTruckId }),
      collectionCount('vendor_compliance_audits', { food_truck_id: foodTruckId }),
      collectionCount('operational_compliance_forms', { food_truck_id: foodTruckId }),
      collectionCount('operational_notifications', { food_truck_id: foodTruckId }),
      collectionCount('tap_to_pay_terminals', { food_truck_id: foodTruckId }),
      collectionCount('tap_to_pay_terminal_events', { food_truck_id: foodTruckId }),
      collectionCount('tap-to-pay-payment-attempts', { food_truck_id: foodTruckId }),
      collectionCount('favorite-food-trucks', { foodTruckId }),
      collectionCount('reviews', { foodTruckId }),
      collectionCount('review-tokens', { foodTruckId }),
    ]),
    Promise.all([
      collectionCount('orders', { $or: [{ foodTruckId }, { food_truck_id: foodTruckId }, { vendor_user_id: userId }] }),
      collectionCount('payment-logs', { $or: [{ foodTruckId }, { food_truck_id: foodTruckId }, { vendor_user_id: userId }] }),
      collectionCount('marketplace-applications', { vendor_user_id: userId }),
      collectionCount('marketplace-bids', { vendor_user_id: userId }),
      collectionCount('event-vendor-applications', { vendor_user_id: userId }),
    ]),
  ]);

  const labels = [
    'Addresses',
    'Bank details',
    'Menu categories',
    'Menu items',
    'Vendor employees',
    'Employee sessions',
    'Employee refund/cancel requests',
    'Employee availability audits',
    'Compliance documents',
    'Compliance provider verifications',
    'Compliance W-9 envelopes',
    'Compliance audit records',
    'Operational compliance forms',
    'Operational notifications',
    'Tap to Pay terminals',
    'Tap to Pay terminal events',
    'Tap to Pay payment attempts',
    'Favorites for this food truck',
    'Reviews for this food truck',
    'Review tokens for this food truck',
  ];
  const blockerLabels = [
    'Orders',
    'Payment logs',
    'Marketplace applications',
    'Marketplace bids',
    'Event-vendor applications',
  ];

  console.log('\nREAD-ONLY DEVELOPER TESTING ACCOUNT DELETE PREVIEW');
  console.log('No data has been changed. No tax IDs, passwords, or provider payloads are displayed.');
  console.table([{
    account: normalizedName(user),
    email: user.email,
    userId: String(userId),
    foodTruck: foodTruck.name,
    foodTruckId: String(foodTruckId),
    inactive: Boolean(foodTruck.inactive),
  }]);
  console.log('\nRECORDS THAT A FOLLOW-UP DELETE WOULD REMOVE');
  console.table(labels.map((collection, index) => ({ collection, records: counts[index] })));
  console.log('\nBLOCKERS — THESE MUST BE ZERO BEFORE AN ACCOUNT DELETE SCRIPT IS CREATED');
  console.table(blockerLabels.map((collection, index) => ({ collection, records: blockers[index] })));

  if (blockers.some(Boolean)) {
    console.log('\nSTOP: transaction or marketplace history exists. No delete script will be created until its treatment is explicitly approved.');
  } else {
    console.log('\nSAFE TO PREPARE A DELETE SCRIPT: no transaction or marketplace-history blockers were found.');
  }
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(`DEVELOPER_TESTING_DELETE_PREVIEW_ERROR=${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
  });
