const DEFAULT_VENDOR_SCHEDULE_TIME_ZONE =
  process.env.VENDOR_SCHEDULE_TIME_ZONE || 'America/New_York';
const DEFAULT_VENDOR_SCHEDULE_RESET_HOUR = Number(
  process.env.VENDOR_SCHEDULE_RESET_HOUR || 4
);

const stateTimeZones = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Denver',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
};

const cityStateTimeZones = {
  'FL:PENSACOLA': 'America/Chicago',
  'FL:PANAMA CITY': 'America/Chicago',
  'FL:TALLAHASSEE': 'America/New_York',
  'IN:EVANSVILLE': 'America/Chicago',
  'IN:GARY': 'America/Chicago',
  'IN:SOUTH BEND': 'America/Indiana/Indianapolis',
  'KY:BOWLING GREEN': 'America/Chicago',
  'KY:LOUISVILLE': 'America/New_York',
  'KY:LEXINGTON': 'America/New_York',
  'MI:IRONWOOD': 'America/Menominee',
  'MI:DETROIT': 'America/Detroit',
  'TN:MEMPHIS': 'America/Chicago',
  'TN:NASHVILLE': 'America/Chicago',
  'TN:CHATTANOOGA': 'America/New_York',
  'TN:KNOXVILLE': 'America/New_York',
  'TX:EL PASO': 'America/Denver',
};

const normalizeAddressPart = (value) =>
  String(value || '')
    .trim()
    .toUpperCase();

const getVendorAddressSignature = (vendor) =>
  [
    normalizeAddressPart(vendor?.addressCity),
    normalizeAddressPart(vendor?.addressState),
    normalizeAddressPart(vendor?.addressPostal),
  ].join('|');

const resolveVendorScheduleTimeZone = (vendor) => {
  const state = normalizeAddressPart(vendor?.addressState);
  const city = normalizeAddressPart(vendor?.addressCity);
  const cityStateKey = `${state}:${city}`;

  if (cityStateTimeZones[cityStateKey]) {
    return {
      timeZone: cityStateTimeZones[cityStateKey],
      source: 'CITY_STATE',
    };
  }

  if (stateTimeZones[state]) {
    return {
      timeZone: stateTimeZones[state],
      source: 'STATE',
    };
  }

  return {
    timeZone: DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
    source: 'FALLBACK',
  };
};

const getZonedDateParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  return parts.reduce((acc, part) => {
    if (part.type !== 'literal') {
      acc[part.type] = Number(part.value);
    }
    return acc;
  }, {});
};

const getTimeZoneOffsetMs = (date, timeZone) => {
  const parts = getZonedDateParts(date, timeZone);
  return (
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    ) - date.getTime()
  );
};

const zonedDateTimeToUtc = ({ year, month, day, hour, minute = 0, second = 0 }, timeZone) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return new Date(utcGuess.getTime() - getTimeZoneOffsetMs(utcGuess, timeZone));
};

const getNextVendorScheduleResetAt = (
  timeZone = DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
  now = new Date()
) => {
  const resetHour = Number.isFinite(DEFAULT_VENDOR_SCHEDULE_RESET_HOUR)
    ? DEFAULT_VENDOR_SCHEDULE_RESET_HOUR
    : 4;
  const parts = getZonedDateParts(now, timeZone);
  let resetAt = zonedDateTimeToUtc(
    {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: resetHour,
    },
    timeZone
  );

  if (resetAt.getTime() <= now.getTime()) {
    const nextDay = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 1));
    resetAt = zonedDateTimeToUtc(
      {
        year: nextDay.getUTCFullYear(),
        month: nextDay.getUTCMonth() + 1,
        day: nextDay.getUTCDate(),
        hour: resetHour,
      },
      timeZone
    );
  }

  return resetAt;
};

const applyVendorScheduleTimeZoneCache = (foodTruck, vendor) => {
  if (!foodTruck || !vendor) {
    return false;
  }

  const addressSignature = getVendorAddressSignature(vendor);
  const resolved = resolveVendorScheduleTimeZone(vendor);
  const changed =
    foodTruck.schedule_time_zone !== resolved.timeZone ||
    foodTruck.schedule_time_zone_source !== resolved.source ||
    foodTruck.schedule_address_signature !== addressSignature;

  if (!changed) {
    return false;
  }

  foodTruck.schedule_time_zone = resolved.timeZone;
  foodTruck.schedule_time_zone_source = resolved.source;
  foodTruck.schedule_address_signature = addressSignature;
  foodTruck.schedule_time_zone_updated_at = new Date();
  return true;
};

module.exports = {
  DEFAULT_VENDOR_SCHEDULE_TIME_ZONE,
  applyVendorScheduleTimeZoneCache,
  getVendorAddressSignature,
  getNextVendorScheduleResetAt,
  resolveVendorScheduleTimeZone,
};
