const getMarketplaceBudgetGuestCount = (event = {}) => {
  const regularGuests = Math.max(0, Number(event.number_of_guests || 0));
  const vipGuests = event.vip_section_enabled
    ? Math.max(0, Number(event.vip_guest_count || 0))
    : 0;
  if (event.fully_catered_event) return regularGuests + vipGuests;
  if (event.catered_vip_section_enabled) return vipGuests;
  return regularGuests;
};

const getAllowedBidCoverages = (event = {}) => {
  if (event.fully_catered_event) {
    const hasRegularGuests = Number(event.number_of_guests || 0) > 0;
    const hasVipGuests = Number(event.vip_guest_count || 0) > 0;
    if (hasRegularGuests && hasVipGuests) return ['REGULAR', 'VIP', 'BOTH'];
    if (hasVipGuests) return ['VIP'];
    return ['REGULAR'];
  }
  if (event.catered_vip_section_enabled) {
    return event.ga_food_sales_allowed ? ['VIP', 'BOTH'] : ['VIP'];
  }
  return ['REGULAR'];
};

const getAllowedAwardCoverages = (event = {}, offeredCoverage = 'REGULAR') =>
  offeredCoverage === 'BOTH'
    ? getAllowedBidCoverages(event)
    : [offeredCoverage];

const ceilPerHundred = (value) => {
  const count = Math.max(0, Number(value || 0));
  return count > 0 ? Math.ceil(count / 100) : 0;
};

const getMarketplaceVendorCapacity = (event = {}) => {
  const gaGuests = Math.max(0, Number(event.number_of_guests || 0));
  const vipGuests = event.vip_section_enabled
    ? Math.max(0, Number(event.vip_guest_count || 0))
    : 0;
  if (event.fully_catered_event) {
    const gaMaximum = ceilPerHundred(gaGuests);
    const vipRequirement = ceilPerHundred(vipGuests);
    const calculatedMaximum = Math.max(1, gaMaximum, vipRequirement);
    return {
      gaMaximum,
      vipRequirement,
      calculatedMaximum,
    };
  }
  if (event.catered_vip_section_enabled) {
    const gaMaximum = event.ga_food_sales_allowed
      ? ceilPerHundred(gaGuests)
      : 0;
    const vipRequirement = Math.max(1, ceilPerHundred(vipGuests));
    const calculatedMaximum = event.separate_vip_vendor_required
      ? gaMaximum + vipRequirement
      : Math.max(gaMaximum, vipRequirement);
    return { gaMaximum, vipRequirement, calculatedMaximum };
  }
  const gaMaximum = Math.max(1, ceilPerHundred(gaGuests));
  return { gaMaximum, vipRequirement: 0, calculatedMaximum: gaMaximum };
};

const getMarketplaceServiceRequirements = (event = {}, selectedRequirement) => {
  const capacity = getMarketplaceVendorCapacity(event);
  const selected = Number.isFinite(Number(selectedRequirement))
    ? Math.max(0, Number(selectedRequirement))
    : capacity.calculatedMaximum;
  if (event.fully_catered_event) {
    return {
      gaRequirement: capacity.gaMaximum,
      vipRequirement: capacity.vipRequirement,
    };
  }
  const vipRequirement = event.catered_vip_section_enabled
    ? capacity.vipRequirement
    : 0;
  const gaRequirement = event.separate_vip_vendor_required
    ? Math.max(0, selected - vipRequirement)
    : Math.min(capacity.gaMaximum, selected);
  return { gaRequirement, vipRequirement };
};

const getMarketplaceFilledSlotSummary = ({
  bids = [],
  applications = [],
  separateVipVendorRequired = false,
  gaRequirement = 0,
  vipRequirement = 0,
} = {}) => {
  const activeBids = bids.filter((bid) =>
    bid && bid.archived_at == null && bid.bid_status === 'AWARDED'
  );
  const activeApplications = applications.filter((application) =>
    application &&
    application.archived_at == null &&
    ['ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED'].includes(application.application_status)
  );
  const gaVendors = new Set();
  const vipVendors = new Set();
  const combinedVendors = new Set();
  activeApplications.forEach((record) => gaVendors.add(String(record.vendor_user_id || '')));
  activeBids.forEach((record) => {
    const vendorId = String(record.vendor_user_id || '');
    const coverage = record.awarded_coverage || record.guest_coverage;
    if (['REGULAR', 'BOTH'].includes(coverage)) gaVendors.add(vendorId);
    if (['VIP', 'BOTH'].includes(coverage)) vipVendors.add(vendorId);
    if (coverage === 'BOTH') combinedVendors.add(vendorId);
  });
  gaVendors.delete('');
  vipVendors.delete('');
  combinedVendors.delete('');
  const gaSlotsFilled = gaVendors.size;
  const vipSlotsFilled = vipVendors.size;
  const combinedCount = combinedVendors.size;
  const minimumUniqueVendors = gaSlotsFilled + vipSlotsFilled - combinedCount;
  const remainingGaSlots = Math.max(0, Number(gaRequirement || 0) - gaSlotsFilled);
  const remainingVipSlots = Math.max(0, Number(vipRequirement || 0) - vipSlotsFilled);
  const totalServiceSlotsRequired = Number(gaRequirement || 0) + Number(vipRequirement || 0);
  const totalServiceSlotsFilled = gaSlotsFilled + vipSlotsFilled;
  const remainingTotalServiceSlots = remainingGaSlots + remainingVipSlots;
  const remainingUniqueVendors = Math.max(remainingGaSlots, remainingVipSlots);
  return {
    gaSlotsFilled,
    vipSlotsFilled,
    combinedVendors: combinedCount,
    separateVipVendorRequired: Boolean(separateVipVendorRequired),
    minimumUniqueVendors,
    totalServiceSlotsRequired,
    totalServiceSlotsFilled,
    remainingGaSlots,
    remainingVipSlots,
    remainingTotalServiceSlots,
    remainingUniqueVendors,
  };
};

const isMarketplaceVendorReductionBlocked = ({
  selectedRequirement = 0,
  gaRequirement = 0,
  vipRequirement = 0,
  filled = {},
} = {}) =>
  Number(selectedRequirement) < Number(filled.minimumUniqueVendors || 0) ||
  Number(gaRequirement) < Number(filled.gaSlotsFilled || 0) ||
  Number(vipRequirement) < Number(filled.vipSlotsFilled || 0);

module.exports = {
  getAllowedBidCoverages,
  getAllowedAwardCoverages,
  getMarketplaceBudgetGuestCount,
  getMarketplaceVendorCapacity,
  getMarketplaceServiceRequirements,
  getMarketplaceFilledSlotSummary,
  isMarketplaceVendorReductionBlocked,
};
