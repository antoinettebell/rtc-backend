const assert = require('assert');
const { hydrateEventVendorUser } = require('./event-vendor-user-hydration');

const run = async () => {
  for (const profile of [null, { review_status: 'DRAFT' }, { review_status: 'PENDING_REVIEW' }, { review_status: 'REJECTED' }, { review_status: 'APPROVED' }]) {
    const user = { _id: 'vendor-1', vendorSubtype: 'EVENT_VENDOR', requestStatus: 'PENDING', foodTruck: { _id: 'wrong' } };
    const hydrated = await hydrateEventVendorUser(user, {
      ProfileModel: { findOne: () => ({ lean: async () => profile }) },
    });
    assert.equal(hydrated.foodTruck, null);
    assert.equal(hydrated.eventVendorProfile, profile);
  }
  const foodVendor = { _id: 'food-1', vendorSubtype: 'FOOD_VENDOR' };
  assert.equal(await hydrateEventVendorUser(foodVendor), foodVendor);
  console.log('Marketplace Vendor user hydration tests passed');
};

run();
