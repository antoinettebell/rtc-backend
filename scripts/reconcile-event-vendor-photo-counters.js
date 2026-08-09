require('dotenv').config({ path: './.env' });
require('../src/db/connection');
const { EventVendorProfileModel } = require('../src/models');
const { reconcileRepositoryPhotoCounters } = require('../src/helper/event-vendor-photo-counter');

const run = async () => {
  const profiles = await EventVendorProfileModel.find({ status: 'ACTIVE' }).select('profile_id').lean();
  for (const profile of profiles) {
    await reconcileRepositoryPhotoCounters(profile.profile_id, { force: true });
  }
  console.log(`Reconciled ${profiles.length} Marketplace Vendor photo repositories.`);
  process.exit(0);
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
