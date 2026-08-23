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
  const specialtyOnly = event.dessert_caterer_required || event.drinks_caterer_required
    ? ['SPECIALTY']
    : [];
  if (event.fully_catered_event) {
    const hasRegularGuests = Number(event.number_of_guests || 0) > 0;
    const hasVipGuests = Number(event.vip_guest_count || 0) > 0;
    if (hasRegularGuests && hasVipGuests) return ['REGULAR', 'VIP', 'BOTH', ...specialtyOnly];
    if (hasVipGuests) return ['VIP', ...specialtyOnly];
    return ['REGULAR', ...specialtyOnly];
  }
  if (event.catered_vip_section_enabled) {
    return event.ga_food_sales_allowed ? ['VIP', 'BOTH', ...specialtyOnly] : ['VIP', ...specialtyOnly];
  }
  return ['REGULAR', ...specialtyOnly];
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
    // GA capacity is operational capacity, not the vendor-fee decision.
    // A coordinator can prohibit GA sales while still needing one vendor per 100 GA guests.
    const gaMaximum = Math.max(1, ceilPerHundred(gaGuests));
    const vipRequirement = 1;
    const dessertRequirement = event.dessert_caterer_required ? 1 : 0;
    const drinksRequirement = event.drinks_caterer_required ? 1 : 0;
    return {
      gaMaximum,
      vipRequirement,
      dessertRequirement,
      drinksRequirement,
      calculatedMaximum: gaMaximum + vipRequirement + dessertRequirement + drinksRequirement,
    };
  }
  const gaMaximum = Math.max(1, ceilPerHundred(gaGuests));
  return { gaMaximum, vipRequirement: 0, dessertRequirement: 0, drinksRequirement: 0, calculatedMaximum: gaMaximum };
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
      ...(capacity.dessertRequirement ? { dessertRequirement: capacity.dessertRequirement } : {}),
      ...(capacity.drinksRequirement ? { drinksRequirement: capacity.drinksRequirement } : {}),
    };
  }
  // Category requirements stay intact when Admin intentionally keeps the
  // overall target lower because one vendor can fulfill multiple categories.
  const vipRequirement = event.catered_vip_section_enabled ? capacity.vipRequirement : 0;
  const dessertRequirement = capacity.dessertRequirement || 0;
  const drinksRequirement = capacity.drinksRequirement || 0;
  const gaRequirement = capacity.gaMaximum || 0;
  return {
    gaRequirement,
    vipRequirement,
    ...(dessertRequirement ? { dessertRequirement } : {}),
    ...(drinksRequirement ? { drinksRequirement } : {}),
  };
};

const getMarketplaceFilledSlotSummary = ({
  bids = [],
  applications = [],
  separateVipVendorRequired = false,
  gaRequirement = 0,
  vipRequirement = 0,
  dessertRequirement = 0,
  drinksRequirement = 0,
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
  const dessertVendors = new Set();
  const drinksVendors = new Set();
  activeApplications.forEach((record) => gaVendors.add(String(record.vendor_user_id || '')));
  activeBids.forEach((record) => {
    const vendorId = String(record.vendor_user_id || '');
    const coverage = record.awarded_coverage || record.guest_coverage;
    if (['REGULAR', 'BOTH'].includes(coverage)) gaVendors.add(vendorId);
    if (['VIP', 'BOTH'].includes(coverage)) vipVendors.add(vendorId);
    if (coverage === 'BOTH') combinedVendors.add(vendorId);
    const specialties = record.awarded_specialty_services || record.specialty_services || [];
    if (specialties.includes('DESSERTS')) dessertVendors.add(vendorId);
    if (specialties.includes('DRINKS')) drinksVendors.add(vendorId);
  });
  gaVendors.delete('');
  vipVendors.delete('');
  combinedVendors.delete('');
  dessertVendors.delete('');
  drinksVendors.delete('');
  const gaSlotsFilled = gaVendors.size;
  const vipSlotsFilled = vipVendors.size;
  const combinedCount = combinedVendors.size;
  const dessertSlotsFilled = dessertVendors.size;
  const drinksSlotsFilled = drinksVendors.size;
  const activeVendorIds = new Set([
    ...gaVendors,
    ...vipVendors,
    ...dessertVendors,
    ...drinksVendors,
  ]);
  const minimumUniqueVendors = activeVendorIds.size;
  const remainingGaSlots = Math.max(0, Number(gaRequirement || 0) - gaSlotsFilled);
  const remainingVipSlots = Math.max(0, Number(vipRequirement || 0) - vipSlotsFilled);
  const remainingDessertSlots = Math.max(0, Number(dessertRequirement || 0) - dessertSlotsFilled);
  const remainingDrinksSlots = Math.max(0, Number(drinksRequirement || 0) - drinksSlotsFilled);
  const totalServiceSlotsRequired = Number(gaRequirement || 0) + Number(vipRequirement || 0) + Number(dessertRequirement || 0) + Number(drinksRequirement || 0);
  const totalServiceSlotsFilled = gaSlotsFilled + vipSlotsFilled + dessertSlotsFilled + drinksSlotsFilled;
  const remainingTotalServiceSlots = remainingGaSlots + remainingVipSlots + remainingDessertSlots + remainingDrinksSlots;
  const remainingUniqueVendors = Math.max(
    remainingGaSlots,
    remainingVipSlots,
    remainingDessertSlots,
    remainingDrinksSlots,
  );
  return {
    gaSlotsFilled,
    vipSlotsFilled,
    ...(dessertRequirement || dessertSlotsFilled ? { dessertSlotsFilled } : {}),
    ...(drinksRequirement || drinksSlotsFilled ? { drinksSlotsFilled } : {}),
    combinedVendors: combinedCount,
    separateVipVendorRequired: Boolean(separateVipVendorRequired),
    minimumUniqueVendors,
    totalServiceSlotsRequired,
    totalServiceSlotsFilled,
    remainingGaSlots,
    remainingVipSlots,
    ...(dessertRequirement || dessertSlotsFilled ? { remainingDessertSlots } : {}),
    ...(drinksRequirement || drinksSlotsFilled ? { remainingDrinksSlots } : {}),
    remainingTotalServiceSlots,
    remainingUniqueVendors,
  };
};

const isMarketplaceVendorReductionBlocked = ({
  selectedRequirement = 0,
  gaRequirement = 0,
  vipRequirement = 0,
  dessertRequirement = 0,
  drinksRequirement = 0,
  filled = {},
} = {}) =>
  Number(selectedRequirement) < Number(filled.minimumUniqueVendors || 0) ||
  Number(gaRequirement) < Number(filled.gaSlotsFilled || 0) ||
  Number(vipRequirement) < Number(filled.vipSlotsFilled || 0) ||
  Number(dessertRequirement) < Number(filled.dessertSlotsFilled || 0) ||
  Number(drinksRequirement) < Number(filled.drinksSlotsFilled || 0);

module.exports = {
  getAllowedBidCoverages,
  getAllowedAwardCoverages,
  getMarketplaceBudgetGuestCount,
  getMarketplaceVendorCapacity,
  getMarketplaceServiceRequirements,
  getMarketplaceFilledSlotSummary,
  isMarketplaceVendorReductionBlocked,
};
