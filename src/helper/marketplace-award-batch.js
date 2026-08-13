const FOOD_APPLICATION_AWARDED_STATUSES = new Set([
  'ACCEPTED',
  'PAYMENT_DUE',
  'PAID',
  'CONFIRMED',
]);

const vendorId = (record = {}) => String(
  record.vendor_user_id?._id || record.vendor_user_id?.id || record.vendor_user_id || ''
);

const getAwardedFoodVendorIds = ({ bids = [], applications = [] } = {}) => {
  const ids = new Set();
  (bids || []).forEach((bid) => {
    if (bid?.archived_at == null && String(bid?.bid_status || '').toUpperCase() === 'AWARDED') {
      const id = vendorId(bid);
      if (id) ids.add(id);
    }
  });
  (applications || []).forEach((application) => {
    if (
      application?.archived_at == null &&
      FOOD_APPLICATION_AWARDED_STATUSES.has(String(application?.application_status || '').toUpperCase())
    ) {
      const id = vendorId(application);
      if (id) ids.add(id);
    }
  });
  return ids;
};

const getFoodVendorAwardCapacity = ({ event = {}, bids = [], applications = [] } = {}) => {
  const limit = Math.max(1, Number(event.number_of_vendors_needed || 1));
  const awardedVendorIds = getAwardedFoodVendorIds({ bids, applications });
  return {
    limit,
    awarded: awardedVendorIds.size,
    remaining: Math.max(0, limit - awardedVendorIds.size),
    awardedVendorIds,
  };
};

module.exports = {
  FOOD_APPLICATION_AWARDED_STATUSES,
  getAwardedFoodVendorIds,
  getFoodVendorAwardCapacity,
};
