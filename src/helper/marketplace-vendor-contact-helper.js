const deriveMarketplaceVendorContact = ({ user = {}, foodTruck = {} }) => ({
  contact_name:
    [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
    foodTruck.name ||
    'Vendor',
  phone:
    user.mobileNumber ||
    user.phoneNumber ||
    user.phone ||
    foodTruck.phone ||
    '',
  email: user.email || '',
});

const sanitizeMarketplaceContactForCoordinator = (
  record = {},
  { detailsUnlocked = false, fullAccess = false } = {}
) => {
  const value = { ...record };
  if (!detailsUnlocked && !fullAccess) {
    delete value.phone;
    delete value.contact_number;
    delete value.email;
    delete value.contact_name;
    delete value.business_name;
    if (value.vendor_user_id && typeof value.vendor_user_id === 'object') {
      value.vendor_user_id = { _id: value.vendor_user_id._id };
    }
  }
  return value;
};

module.exports = {
  deriveMarketplaceVendorContact,
  sanitizeMarketplaceContactForCoordinator,
};
