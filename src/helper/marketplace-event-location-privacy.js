const PRIVATE_LOCATION_FIELDS = [
  'event_address',
  'formatted_address',
  'geocoded_address',
  'latitude',
  'longitude',
  'place_id',
  'geocoding_provider',
  'geocoded_at',
];

const applyMarketplaceEventLocationPrivacy = (event, { locationUnlocked }) => {
  const visibleEvent = { ...event, exact_address_locked: !locationUnlocked };
  if (!locationUnlocked) {
    PRIVATE_LOCATION_FIELDS.forEach((field) => delete visibleEvent[field]);
  }
  return visibleEvent;
};

module.exports = { applyMarketplaceEventLocationPrivacy };
