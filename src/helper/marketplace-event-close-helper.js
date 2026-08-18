const parseEventTime = (value) => {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = String(match[3] || '').toUpperCase();
  if (minute > 59 || hour > (meridiem ? 12 : 23)) return null;
  if (meridiem) {
    if (hour === 12) hour = 0;
    if (meridiem === 'PM') hour += 12;
  }
  return { hour, minute };
};

const getTimeZoneOffsetMs = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant).reduce((values, part) => {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
    return values;
  }, {});
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return representedAsUtc - instant.getTime();
};

const zonedDateTimeToUtc = ({ year, month, day, hour, minute, timeZone }) => {
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let candidate = new Date(localAsUtc);
  let offset = getTimeZoneOffsetMs(candidate, timeZone);
  candidate = new Date(localAsUtc - offset);
  const correctedOffset = getTimeZoneOffsetMs(candidate, timeZone);
  if (correctedOffset !== offset) candidate = new Date(localAsUtc - correctedOffset);
  return candidate;
};

const combineMarketplaceDateAndTime = ({
  dateValue,
  timeValue,
  timeZone = 'America/New_York',
}) => {
  const date = new Date(dateValue);
  const time = parseEventTime(timeValue || '23:59');
  if (Number.isNaN(date.getTime()) || !time) return null;

  try {
    return zonedDateTimeToUtc({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
      timeZone,
    });
  } catch (error) {
    return null;
  }
};

const formatMarketplaceCalendarDate = (value) => {
  if (!value) return 'Not set';
  const isoDate = value instanceof Date
    ? Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10)
    : String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)?.[0];
  if (!isoDate) return 'Not set';
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year}`;
};

const formatMarketplaceClockTime = (value) => {
  const time = parseEventTime(value);
  if (!time) return 'Not set';
  const meridiem = time.hour >= 12 ? 'PM' : 'AM';
  const displayHour = time.hour % 12 || 12;
  return `${displayHour}:${String(time.minute).padStart(2, '0')} ${meridiem}`;
};

const isMarketplaceCloseBeforeEvent = ({
  eventDate,
  eventTime,
  eventCloseAt,
  timeZone = 'America/New_York',
}) => {
  const eventStartAt = combineMarketplaceDateAndTime({
    dateValue: eventDate,
    timeValue: eventTime,
    timeZone,
  });
  const closeAt = new Date(eventCloseAt);
  return Boolean(
    eventStartAt &&
    !Number.isNaN(closeAt.getTime()) &&
    closeAt.getTime() < eventStartAt.getTime()
  );
};

const getMarketplaceEventTiming = (event = {}) => {
  const date = new Date(event.event_date);
  const time = parseEventTime(event.event_time);
  const durationMinutes = Number(event.event_duration_minutes || 0) +
    Number(event.event_duration_hours || 0) * 60;
  if (Number.isNaN(date.getTime()) || !time || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  try {
    const startAt = zonedDateTimeToUtc({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: time.hour,
      minute: time.minute,
      timeZone: event.event_timezone || 'America/New_York',
    });
    const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
    return {
      start_at: startAt,
      end_at: endAt,
      final_payment_available_at: startAt,
      // Retained for mobile response compatibility; final payment now opens at event start.
      vendor_close_available_at: startAt,
    };
  } catch (error) {
    return null;
  }
};

const isFinalPaymentAvailable = (event = {}, now = new Date()) => {
  const timing = getMarketplaceEventTiming(event);
  return Boolean(
    timing && new Date(now).getTime() >= timing.final_payment_available_at.getTime()
  );
};

const buildVendorEventCloseState = (event = {}, now = new Date()) => {
  const timing = getMarketplaceEventTiming(event);
  const paymentStatus = event.final_payment_status || 'NOT_REQUIRED';
  if (!timing) {
    return {
      can_close: false,
      status: 'EVENT_TIME_UNAVAILABLE',
      event_end_at: null,
      available_at: null,
      seconds_remaining: null,
    };
  }
  if (event.final_payment_id || ['PENDING', 'PAID'].includes(paymentStatus)) {
    return {
      can_close: false,
      status: paymentStatus === 'PAID' ? 'PAID' : 'PAYMENT_CREATED',
      event_end_at: timing.end_at.toISOString(),
      available_at: timing.vendor_close_available_at.toISOString(),
      seconds_remaining: 0,
    };
  }
  const remainingMs = timing.final_payment_available_at.getTime() - new Date(now).getTime();
  return {
    can_close: remainingMs <= 0,
    status: remainingMs <= 0 ? 'AVAILABLE' : 'WAITING_FOR_EVENT_START',
    event_end_at: timing.end_at.toISOString(),
    available_at: timing.final_payment_available_at.toISOString(),
    seconds_remaining: Math.max(0, Math.ceil(remainingMs / 1000)),
  };
};

module.exports = {
  buildVendorEventCloseState,
  combineMarketplaceDateAndTime,
  formatMarketplaceCalendarDate,
  formatMarketplaceClockTime,
  getMarketplaceEventTiming,
  isMarketplaceCloseBeforeEvent,
  isFinalPaymentAvailable,
};
