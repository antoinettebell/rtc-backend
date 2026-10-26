/*
 * Deletes the confirmed development vendor/payee test-data cohort only.
 *
 * This intentionally does not delete S3 objects, menus, orders, marketplace
 * events, plans, settings, or super-admin records.
 *
 * Dry run: node scripts/delete-development-payee-test-data.js
 * Apply:   node scripts/delete-development-payee-test-data.js --apply --confirm=DELETE_DEV_PAYEE_TEST_DATA
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
  VendorComplianceDocumentModel,
  VendorComplianceProviderVerificationModel,
  VendorComplianceW9EnvelopeModel,
  VendorComplianceAuditModel,
} = require('../src/models');

const CONFIRMATION = 'DELETE_DEV_PAYEE_TEST_DATA';
const args = new Set(process.argv.slice(2));
const apply = args.has('--apply') && args.has(`--confirm=${CONFIRMATION}`);

const foodTruckIds = [
  '6a7941d1a8bedd9236dc7b49', // Devins Deviled Eggs — orphaned test record
  '6a794b1e90a4c908a35957d3', // Instagram Glizzys — Sample Lady
  '6a7ab21f6861507844f768b2', // Otp check — orphaned test record
  '6a7acaf2d933aeecff742170', // Workflow vendor — orphaned test record
  '6a7acb70d933aeecff74217a', // Workflow vendor — orphaned test record
  '6ab5bd9b28a7207fc6533d1b', // Debbies Dogs — Debbie Dixon
];
const userIds = [
  '6a72573089ed0ddcc9089b8d', // Sandra Day
  '6a75505c71a35e1c0f736510', // Merchandise Vendor
  '6a793d82a8bedd9236dc791d', // Misty Smithson
  '6a794b1d90a4c908a35957d0', // Sample Lady
  '6ab5bd9a28a7207fc6533d18', // Debbie Dixon
];

const expectedFoodTruckNames = new Set([
  'Devins Deviled Eggs',
  'Instagram Glizzys',
  'Otp check ',
  'Workflow vendor',
  'Debbies Dogs',
]);
const expectedUserEmails = new Set([
  'antoinetteb@sumpterbell.com',
  'abell@roundthecornerapp.com',
  'developer@roundthecornerapp.com',
  'deleted+6a794b1d90a4c908a35957d0@rounddacorner.invalid',
  'deboraha1031@gmail.com',
]);
const expectedMarketplaceBusinesses = new Set(['Smith And Wesson Purses', 'Clothing']);

const verifyExactTargetSet = async () => {
  const [foodTrucks, users, marketplaceProfiles] = await Promise.all([
    FoodTruckModel.find({ _id: { $in: foodTruckIds } }).select('_id name').lean(),
    UserModel.find({ _id: { $in: userIds } }).select('_id email userType').lean(),
    EventVendorProfileModel.find({ vendor_user_id: { $in: userIds } })
      .select('_id business_name vendor_user_id')
      .lean(),
  ]);

  if (foodTrucks.length !== foodTruckIds.length) {
    throw new Error('Food-truck target set no longer matches the reviewed preview. No data was changed.');
  }
  if (users.length !== userIds.length) {
    throw new Error('User target set no longer matches the reviewed preview. No data was changed.');
  }
  if (marketplaceProfiles.length !== expectedMarketplaceBusinesses.size) {
    throw new Error('Marketplace target set no longer matches the reviewed preview. No data was changed.');
  }
  for (const record of foodTrucks) {
    if (!expectedFoodTruckNames.has(record.name)) {
      throw new Error('Unexpected food-truck name in the deletion set. No data was changed.');
    }
  }
  for (const record of users) {
    if (!expectedUserEmails.has(record.email) || record.userType === 'SUPER_ADMIN') {
      throw new Error('Unexpected or protected user in the deletion set. No data was changed.');
    }
  }
  for (const record of marketplaceProfiles) {
    if (!expectedMarketplaceBusinesses.has(record.business_name)) {
      throw new Error('Unexpected Marketplace vendor in the deletion set. No data was changed.');
    }
  }

  return { foodTrucks, users, marketplaceProfiles };
};

const run = async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured.');
  await mongoose.connect(process.env.MONGO_URI);

  const targets = await verifyExactTargetSet();
  console.log(`Validated ${targets.foodTrucks.length} food trucks, ${targets.users.length} users, and ${targets.marketplaceProfiles.length} Marketplace vendor profiles.`);

  if (!apply) {
    console.log('DRY RUN ONLY — no data changed.');
    console.log(`To delete the reviewed target set, rerun with: --apply --confirm=${CONFIRMATION}`);
    return;
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const options = { session };
      // MongoDB transactions must execute operations serially on the session.
      const foodDocuments = await VendorComplianceDocumentModel.deleteMany({ food_truck_id: { $in: foodTruckIds } }, options);
      const foodProviderVerifications = await VendorComplianceProviderVerificationModel.deleteMany({ food_truck_id: { $in: foodTruckIds } }, options);
      const foodW9Envelopes = await VendorComplianceW9EnvelopeModel.deleteMany({ food_truck_id: { $in: foodTruckIds } }, options);
      const foodAudits = await VendorComplianceAuditModel.deleteMany({ food_truck_id: { $in: foodTruckIds } }, options);
      const marketplaceComplianceProfiles = await MarketplaceVendorComplianceProfileModel.deleteMany({ vendor_user_id: { $in: userIds } }, options);
      const marketplaceProviderVerifications = await MarketplaceVendorComplianceProviderVerificationModel.deleteMany({ vendor_user_id: { $in: userIds } }, options);
      const marketplaceW9Envelopes = await MarketplaceVendorComplianceW9EnvelopeModel.deleteMany({ vendor_user_id: { $in: userIds } }, options);
      const marketplaceBankDetails = await MarketplaceVendorBankDetailModel.deleteMany({ vendor_user_id: { $in: userIds } }, options);
      const bankDetails = await BankDetailModel.deleteMany({ userId: { $in: userIds } }, options);
      const marketplaceProfiles = await EventVendorProfileModel.deleteMany({ vendor_user_id: { $in: userIds } }, options);
      const foodTrucks = await FoodTruckModel.deleteMany({ _id: { $in: foodTruckIds } }, options);
      const users = await UserModel.deleteMany({ _id: { $in: userIds } }, options);
      result = {
        foodDocuments: foodDocuments.deletedCount,
        foodProviderVerifications: foodProviderVerifications.deletedCount,
        foodW9Envelopes: foodW9Envelopes.deletedCount,
        foodAudits: foodAudits.deletedCount,
        marketplaceComplianceProfiles: marketplaceComplianceProfiles.deletedCount,
        marketplaceProviderVerifications: marketplaceProviderVerifications.deletedCount,
        marketplaceW9Envelopes: marketplaceW9Envelopes.deletedCount,
        marketplaceBankDetails: marketplaceBankDetails.deletedCount,
        bankDetails: bankDetails.deletedCount,
        marketplaceProfiles: marketplaceProfiles.deletedCount,
        foodTrucks: foodTrucks.deletedCount,
        users: users.deletedCount,
      };
    });
  } finally {
    await session.endSession();
  }

  console.log('DELETE COMPLETE — only the confirmed development payee test-data cohort was removed.');
  console.table(result);
};

run()
  .then(() => mongoose.disconnect())
  .catch(async (error) => {
    console.error(`PAYEE_TEST_DATA_DELETE_ERROR=${error.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
