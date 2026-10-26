/*
 * Read-only development-data inventory.
 *
 * This script intentionally does not write, delete, update, or archive any
 * MongoDB records. It identifies the agreed retained legal-payee cohort and
 * reports the associated records that are candidates for a later, separately
 * approved cleanup.
 *
 * Run: node scripts/preview-development-payee-cleanup.js
 */
require('dotenv').config({ path: './.env' });

const mongoose = require('mongoose');
const {
  UserModel,
  FoodTruckModel,
  BankDetailModel,
  EventVendorProfileModel,
  MarketplaceVendorBankDetailModel,
  MarketplaceVendorComplianceProfileModel,
  MarketplaceVendorComplianceProviderVerificationModel,
  MarketplaceVendorComplianceW9EnvelopeModel,
  CoordinatorComplianceProfileModel,
  CoordinatorComplianceProviderVerificationModel,
  CoordinatorComplianceW9EnvelopeModel,
  VendorComplianceDocumentModel,
  VendorComplianceProviderVerificationModel,
  VendorComplianceW9EnvelopeModel,
  VendorComplianceAuditModel,
} = require('../src/models');

const retainedFoodVendors = [
  { email: 'antoinettetbell1@icloud.com', foodTruckName: 'Jazzy Fried Rice' },
  { email: 'vendor_demo@example.com', foodTruckName: 'Pizza House' },
];
const retainedMarketplaceVendors = [
  { email: 'tanyas_11207@yahoo.com', businessName: 'Tillys Candle' },
];
const retainedCoordinatorEmails = [
  'support@roundthecornerapp.com',
  'antoinetteb@readysetmowsc.com',
];

const ids = (records) => records.map((record) => record._id);
const names = (records) => records.map((record) => ({
  id: String(record._id),
  email: record.email || '',
  name: `${record.firstName || ''} ${record.lastName || ''}`.trim(),
  userType: record.userType || '',
  vendorSubtype: record.vendorSubtype || '',
  coordinator: Boolean(record.isEventCoordinator),
}));
const count = (model, filter) => model.countDocuments(filter);

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not configured. No database connection was attempted.');
  }
  await mongoose.connect(process.env.MONGO_URI);

  const allFoodTrucks = await FoodTruckModel.find({})
    .select('_id name userId inactive')
    .populate('userId', 'email firstName lastName userType vendorSubtype isEventCoordinator')
    .lean();
  const keptFoodTrucks = allFoodTrucks.filter((truck) =>
    retainedFoodVendors.some((retained) =>
      truck.name === retained.foodTruckName && truck.userId?.email === retained.email
    )
  );
  const cleanupFoodTrucks = allFoodTrucks.filter(
    (truck) => !keptFoodTrucks.some((retained) => String(retained._id) === String(truck._id))
  );

  const allMarketplaceProfiles = await EventVendorProfileModel.find({})
    .select('_id profile_id business_name vendor_user_id status review_status')
    .populate('vendor_user_id', 'email firstName lastName userType vendorSubtype isEventCoordinator')
    .lean();
  const keptMarketplaceProfiles = allMarketplaceProfiles.filter((profile) =>
    retainedMarketplaceVendors.some((retained) =>
      profile.business_name === retained.businessName && profile.vendor_user_id?.email === retained.email
    )
  );

  const keptCoordinatorUsers = await UserModel.find({
    email: { $in: retainedCoordinatorEmails },
  })
    .select('email firstName lastName userType vendorSubtype isEventCoordinator')
    .lean();
  const keptCoordinatorProfiles = await CoordinatorComplianceProfileModel.find({
    coordinator_user_id: { $in: ids(keptCoordinatorUsers) },
  })
    .select('_id coordinator_user_id legal_name party_type')
    .lean();

  if (keptFoodTrucks.length !== retainedFoodVendors.length) {
    throw new Error('Expected retained food vendors were not all found. Cleanup preview stopped.');
  }
  if (keptMarketplaceProfiles.length !== retainedMarketplaceVendors.length) {
    throw new Error('Expected retained Marketplace vendors were not all found. Cleanup preview stopped.');
  }
  if (keptCoordinatorUsers.length !== retainedCoordinatorEmails.length) {
    throw new Error('Expected retained coordinators were not all found. Cleanup preview stopped.');
  }

  const keptFoodTruckIds = ids(keptFoodTrucks);
  const keptFoodUserIds = keptFoodTrucks.map((truck) => truck.userId?._id).filter(Boolean);
  const keptMarketplaceUserIds = keptMarketplaceProfiles
    .map((profile) => profile.vendor_user_id?._id)
    .filter(Boolean);
  const keptCoordinatorUserIds = ids(keptCoordinatorUsers);
  const retainedUserIds = [...keptFoodUserIds, ...keptMarketplaceUserIds, ...keptCoordinatorUserIds];

  const candidateUsers = await UserModel.find({
    _id: { $nin: retainedUserIds },
    userType: { $ne: 'SUPER_ADMIN' },
    $or: [
      { userType: 'VENDOR' },
      { vendorSubtype: 'EVENT_VENDOR' },
      { isEventCoordinator: true },
    ],
  })
    .select('email firstName lastName userType vendorSubtype isEventCoordinator')
    .lean();
  const candidateUserIds = ids(candidateUsers);
  const unexpectedFoodTruckOwners = cleanupFoodTrucks.filter(
    (truck) => !candidateUserIds.some((userId) => String(userId) === String(truck.userId?._id))
  );


  const foodTruckCleanupFilter = { _id: { $nin: keptFoodTruckIds } };
  const bankUserCleanupFilter = { userId: { $in: candidateUserIds } };
  const marketplaceUserCleanupFilter = { vendor_user_id: { $nin: keptMarketplaceUserIds } };
  const coordinatorUserCleanupFilter = { coordinator_user_id: { $nin: keptCoordinatorUserIds } };

  const cleanupCounts = await Promise.all([
    count(FoodTruckModel, foodTruckCleanupFilter),
    count(VendorComplianceDocumentModel, { food_truck_id: { $nin: keptFoodTruckIds } }),
    count(VendorComplianceProviderVerificationModel, { food_truck_id: { $nin: keptFoodTruckIds } }),
    count(VendorComplianceW9EnvelopeModel, { food_truck_id: { $nin: keptFoodTruckIds } }),
    count(VendorComplianceAuditModel, { food_truck_id: { $nin: keptFoodTruckIds } }),
    count(BankDetailModel, bankUserCleanupFilter),
    count(EventVendorProfileModel, { _id: { $nin: ids(keptMarketplaceProfiles) } }),
    count(MarketplaceVendorComplianceProfileModel, marketplaceUserCleanupFilter),
    count(MarketplaceVendorComplianceProviderVerificationModel, marketplaceUserCleanupFilter),
    count(MarketplaceVendorComplianceW9EnvelopeModel, marketplaceUserCleanupFilter),
    count(MarketplaceVendorBankDetailModel, marketplaceUserCleanupFilter),
    count(CoordinatorComplianceProfileModel, coordinatorUserCleanupFilter),
    count(CoordinatorComplianceProviderVerificationModel, coordinatorUserCleanupFilter),
    count(CoordinatorComplianceW9EnvelopeModel, coordinatorUserCleanupFilter),
    Promise.resolve(candidateUsers.length),
  ]);

  console.log('\nREAD-ONLY DEVELOPMENT PAYEE CLEANUP PREVIEW');
  console.log('No data has been changed. Tax IDs, passwords, and provider payloads are not displayed.');

  console.log('\nRETAINED FOOD VENDORS');
  console.table(keptFoodTrucks.map((truck) => ({
    foodTruck: truck.name,
    owner: `${truck.userId?.firstName || ''} ${truck.userId?.lastName || ''}`.trim(),
    email: truck.userId?.email || '',
    foodTruckId: String(truck._id),
  })));
  console.log('\nRETAINED MARKETPLACE VENDORS');
  console.table(keptMarketplaceProfiles.map((profile) => ({
    business: profile.business_name,
    email: profile.vendor_user_id?.email || '',
    marketplaceProfileId: profile.profile_id,
  })));
  console.log('\nRETAINED COORDINATORS');
  console.table(names(keptCoordinatorUsers));

  console.log('\nDELETE CANDIDATE VENDOR/COORDINATOR USERS');
  console.table(names(candidateUsers));
  console.log('\nDELETE CANDIDATE FOOD TRUCKS');
  console.table(cleanupFoodTrucks.map((truck) => ({
    foodTruck: truck.name,
    owner: `${truck.userId?.firstName || ''} ${truck.userId?.lastName || ''}`.trim(),
    email: truck.userId?.email || '',
    inactive: Boolean(truck.inactive),
    foodTruckId: String(truck._id),
  })));
  if (unexpectedFoodTruckOwners.length) {
    console.log('\nREQUIRES A DECISION — FOOD TRUCKS NOT OWNED BY A DELETE-CANDIDATE USER');
    console.table(unexpectedFoodTruckOwners.map((truck) => ({
      foodTruck: truck.name,
      owner: `${truck.userId?.firstName || ''} ${truck.userId?.lastName || ''}`.trim() || 'Missing user',
      email: truck.userId?.email || 'Missing user',
      ownerUserType: truck.userId?.userType || 'Unknown',
      foodTruckId: String(truck._id),
      ownerId: truck.userId?._id ? String(truck.userId._id) : 'Missing user',
    })));
    console.log('These records are excluded from any future delete operation until explicitly classified.');
  }

  const labels = [
    'Food trucks',
    'Food-vendor compliance documents',
    'Food-vendor provider verifications',
    'Food-vendor W-9 envelopes',
    'Food-vendor compliance audits',
    'Bank details belonging to delete candidates',
    'Marketplace vendor profiles',
    'Marketplace compliance profiles',
    'Marketplace provider verifications',
    'Marketplace W-9 envelopes',
    'Marketplace bank details',
    'Coordinator compliance profiles',
    'Coordinator provider verifications',
    'Coordinator W-9 envelopes',
    'Vendor/coordinator user records',
  ];
  console.log('\nDELETE CANDIDATE COUNTS');
  console.table(labels.map((collection, index) => ({ collection, records: cleanupCounts[index] })));

  console.log('\nSTOP: review this preview before any deletion script is created or run.');
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(`PAYEE_CLEANUP_PREVIEW_ERROR=${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
