const LOCKED_EVENT_FIELDS = [
  'payment_responsibility',
  'vendor_fee',
  'budgeted_amount',
  'ga_ticket_price',
  'vip_ticket_price',
  'ticket_sales_enabled',
  'event_vendor_electricity_fee',
  'vendor_fee_payment_deadline',
  'fully_catered_event',
  'ga_food_sales_allowed',
  'catered_vip_section_enabled',
  'separate_vip_vendor_required',
  'waive_vendor_fee_for_combined_award',
  'service_type',
  'service_types',
  'service_styles',
  'event_type',
  'vip_section_enabled',
  'number_of_guests',
  'vip_guest_count',
  'expected_guest_count',
  'expected_vip_guests',
];

const stable = (value) => JSON.stringify(value === undefined ? null : value);

const canonicalVendorNeeds = (needs = []) => needs
  .map(({ vendor_type, type_description, fee }) => ({
    vendor_type: String(vendor_type || '').toUpperCase(),
    type_description: String(type_description || '').trim(),
    fee: Number(fee || 0),
  }))
  .sort((left, right) => left.vendor_type.localeCompare(right.vendor_type));

const vendorNeedDetailsByType = (needs = []) => new Map(
  canonicalVendorNeeds(needs).map((need) => [need.vendor_type, stable(need)]),
);

const getAwardedNeedCount = (awardedMarketplaceVendorCounts, type) => Number(
  awardedMarketplaceVendorCounts?.[String(type || '').toUpperCase()] || 0,
);

const validateAdminEventPublish = ({
  current = {},
  proposed = {},
  hasActivity = false,
  awardedMarketplaceVendorCounts = {},
}) => {
  const errors = [];
  [
    ['ga_ticket_quantity', 'GA ticket capacity'],
    ['vip_ticket_quantity', 'VIP ticket capacity'],
    ['number_of_vendors_needed', 'Food Vendor capacity'],
  ].forEach(([field, label]) => {
    const before = Number(current[field] || 0);
    const after = Number(proposed[field] || 0);
    if (after < before) errors.push({ field, message: `${label} can only stay the same or increase.` });
  });

  const currentNeeds = new Map((current.event_vendor_needs || []).map((need) => [
    String(need.vendor_type || '').toUpperCase(), Number(need.quantity || 0),
  ]));
  const proposedNeeds = new Map((proposed.event_vendor_needs || []).map((need) => [
    String(need.vendor_type || '').toUpperCase(), Number(need.quantity || 0),
  ]));
  currentNeeds.forEach((quantity, type) => {
    const awardedCount = getAwardedNeedCount(awardedMarketplaceVendorCounts, type);
    if ((proposedNeeds.get(type) || 0) < awardedCount) {
      errors.push({
        field: `event_vendor_needs.${type}.quantity`,
        message: `${type} vendor capacity cannot be lower than its ${awardedCount} awarded vendor(s).`,
      });
    }
  });

  if (hasActivity) {
    LOCKED_EVENT_FIELDS.forEach((field) => {
      if (stable(current[field]) !== stable(proposed[field])) {
        errors.push({
          field,
          message: `${field.replace(/_/g, ' ')} cannot change after a submission or payment exists.`,
        });
      }
    });
    const currentNeedDetails = vendorNeedDetailsByType(current.event_vendor_needs);
    const proposedNeedDetails = vendorNeedDetailsByType(proposed.event_vendor_needs);
    const changedExistingNeed = [...currentNeedDetails.entries()].some(
      ([type, details]) =>
        getAwardedNeedCount(awardedMarketplaceVendorCounts, type) > 0 &&
        proposedNeedDetails.get(type) !== details,
    );
    if (changedExistingNeed) {
      errors.push({
        field: 'event_vendor_needs',
        message: 'Marketplace Vendor types with awarded vendors cannot have their descriptions or fees changed. Unawarded types may be edited, reduced, or removed.',
      });
    }
  }
  return errors;
};

module.exports = { LOCKED_EVENT_FIELDS, validateAdminEventPublish };
