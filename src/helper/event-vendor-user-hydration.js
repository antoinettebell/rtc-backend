const { EventVendorProfileModel } = require('../models');

const hydrateEventVendorUser = async (user, { ProfileModel = EventVendorProfileModel } = {}) => {
  if (!user || user.vendorSubtype !== 'EVENT_VENDOR') return user;
  user.foodTruck = null;
  user.eventVendorProfile = await ProfileModel.findOne({
    vendor_user_id: user._id,
    status: 'ACTIVE',
  }).lean();
  return user;
};

module.exports = { hydrateEventVendorUser };
