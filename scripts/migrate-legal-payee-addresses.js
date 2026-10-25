require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const {
  FoodTruckModel,
  MarketplaceVendorComplianceProfileModel,
  UserModel,
} = require('../src/models');

const addressPart = (value) => {
  const text = String(value || '').trim();
  return text && text.toUpperCase() !== 'NA' ? text : null;
};

const addressFromUser = (user = {}) => ({
  line1: addressPart(user.addressLine1),
  line2: addressPart(user.addressLine2),
  city: addressPart(user.addressCity),
  state: addressPart(user.addressState),
  postal: addressPart(user.addressPostal),
  country: addressPart(user.addressCountry) || 'US',
});

const hasRequiredAddress = (address) =>
  !!(address.line1 && address.city && address.state && address.postal);

const run = async ({ apply = process.argv.includes('--apply') } = {}) => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);

  const users = await UserModel.find({ userType: 'VENDOR' })
    .select('_id vendorSubtype addressLine1 addressLine2 addressCity addressState addressPostal addressCountry')
    .lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  const foodTrucks = await FoodTruckModel.find({
    $or: [
      { legal_payee_address_line1: { $exists: false } },
      { legal_payee_address_line1: null },
      { legal_payee_address_line1: '' },
    ],
  }).select('_id userId').lean();
  const foodUpdates = foodTrucks.flatMap((foodTruck) => {
    const address = addressFromUser(userById.get(String(foodTruck.userId)));
    if (!hasRequiredAddress(address)) return [];
    return [{
      updateOne: {
        filter: { _id: foodTruck._id },
        update: { $set: {
          legal_payee_address_line1: address.line1,
          legal_payee_address_line2: address.line2,
          legal_payee_address_city: address.city,
          legal_payee_address_state: address.state,
          legal_payee_address_postal: address.postal,
          legal_payee_address_country: address.country,
        } },
      },
    }];
  });

  const marketplaceProfiles = await MarketplaceVendorComplianceProfileModel.find({
    $or: [
      { mailing_address_line1: { $exists: false } },
      { mailing_address_line1: null },
      { mailing_address_line1: '' },
    ],
  }).select('_id vendor_user_id').lean();
  const marketplaceUpdates = marketplaceProfiles.flatMap((profile) => {
    const address = addressFromUser(userById.get(String(profile.vendor_user_id)));
    if (!hasRequiredAddress(address)) return [];
    return [{
      updateOne: {
        filter: { _id: profile._id },
        update: { $set: {
          mailing_address_line1: address.line1,
          mailing_address_line2: address.line2,
          mailing_city: address.city,
          mailing_state: address.state,
          mailing_postal: address.postal,
          mailing_country: address.country,
        } },
      },
    }];
  });

  const foodResult = apply && foodUpdates.length
    ? await FoodTruckModel.bulkWrite(foodUpdates, { ordered: false })
    : null;
  const marketplaceResult = apply && marketplaceUpdates.length
    ? await MarketplaceVendorComplianceProfileModel.bulkWrite(marketplaceUpdates, { ordered: false })
    : null;
  const result = {
    mode: apply ? 'APPLY' : 'DRY_RUN',
    food_vendor_candidates: foodTrucks.length,
    food_vendor_planned: foodUpdates.length,
    food_vendor_modified: foodResult?.modifiedCount || 0,
    marketplace_vendor_candidates: marketplaceProfiles.length,
    marketplace_vendor_planned: marketplaceUpdates.length,
    marketplace_vendor_modified: marketplaceResult?.modifiedCount || 0,
  };
  console.log('Legal payee address migration', result);
  return result;
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error('Legal payee address migration failed', { message: error.message });
      process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
}

module.exports = { addressFromUser, hasRequiredAddress, run };
