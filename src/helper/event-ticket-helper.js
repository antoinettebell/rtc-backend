const ADMISSIONS_TAX_CODES = Object.freeze({
  'live music / concerts': 'OA020200',
  'live music/concerts': 'OA020200',
  concerts: 'OA020200',
  concert: 'OA020200',
  festival: 'OA020000',
  market: 'OA020000',
  fundraiser: 'OA020000',
  conference: 'OA020300',
  corporate: 'OA020300',
  'sporting events': 'OA020400',
  'theaters / plays': 'OA020800',
  'theaters/plays': 'OA020800',
  'amusement / attractions': 'OA020100',
  'amusement/attractions': 'OA020100',
});

const GENERAL_ADMISSIONS_TAX_CODE = 'OA020000';
const PLATFORM_SERVICE_TAX_CODE = 'SW054003';
const CUSTOMER_PROCESSING_RATE = 0.035;
const COORDINATOR_PROCESSING_RATE = 0.015;
const COORDINATOR_PER_TICKET_FEE = 1;
const {
  getCustomerTicketProcessingFeeAmount,
} = require('./marketplace-regression-test-fees');

const toMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const encodeWalletPaymentToken = (paymentData) => {
  if (paymentData === null || paymentData === undefined || paymentData === '') {
    throw new Error('Payment token missing');
  }
  const serialized = typeof paymentData === 'string'
    ? paymentData
    : JSON.stringify(paymentData);
  if (!serialized) throw new Error('Payment token missing');
  return Buffer.from(serialized).toString('base64');
};

const getAdmissionsTaxCode = (eventType) =>
  ADMISSIONS_TAX_CODES[String(eventType || '').trim().toLowerCase()] ||
  GENERAL_ADMISSIONS_TAX_CODE;

const getEntityUseCode = ({ charitableEvent, religiousOrganization }) => {
  if (religiousOrganization) return 'F';
  if (charitableEvent) return 'E';
  return null;
};

const calculateTicketAmounts = ({ unitPrice, quantity }) => {
  const safePrice = Number(unitPrice);
  const safeQuantity = Number(quantity);
  if (!Number.isFinite(safePrice) || safePrice < 0) {
    throw new Error('Ticket price must be zero or greater');
  }
  if (!Number.isInteger(safeQuantity) || safeQuantity < 1) {
    throw new Error('Ticket quantity must be a positive integer');
  }

  const ticketSubtotal = toMoney(safePrice * safeQuantity);
  const customerProcessingFee = getCustomerTicketProcessingFeeAmount(ticketSubtotal);
  const coordinatorProcessingFee = toMoney(
    ticketSubtotal * COORDINATOR_PROCESSING_RATE +
      safeQuantity * COORDINATOR_PER_TICKET_FEE
  );

  return {
    ticketSubtotal,
    customerProcessingFee,
    coordinatorProcessingFee,
    checkoutSubtotal: toMoney(ticketSubtotal + customerProcessingFee),
    grossCoordinatorPayoutBeforeTax: toMoney(
      ticketSubtotal - coordinatorProcessingFee
    ),
  };
};

const assertInventoryAvailable = ({ capacity, sold, reserved = 0, requested }) => {
  const values = [capacity, sold, reserved, requested].map(Number);
  if (!values.every(Number.isInteger) || values.some((value) => value < 0)) {
    throw new Error('Ticket inventory values must be non-negative integers');
  }
  if (values[3] < 1) throw new Error('At least one ticket is required');

  const remaining = Math.max(0, values[0] - values[1] - values[2]);
  if (values[3] > remaining) {
    const error = new Error(`Only ${remaining} ticket(s) remain`);
    error.code = 'TICKET_INVENTORY_EXCEEDED';
    error.remaining = remaining;
    throw error;
  }
  return remaining - values[3];
};

const calculateMinimumFoodVendors = ({ gaGuests, vipGuests, vipHasSeparateCaterer }) => {
  const guests = Number(gaGuests || 0) +
    (vipHasSeparateCaterer ? 0 : Number(vipGuests || 0));
  return Math.max(1, Math.ceil(guests / 100));
};

const zonedParts = (date, timeZone) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );

const isScannerAvailable = ({ eventDate, timeZone = 'America/New_York', now = new Date(), closedAt }) => {
  if (closedAt) return false;
  const today = zonedParts(now, timeZone);
  const eventDay = String(eventDate instanceof Date ? eventDate.toISOString() : eventDate).slice(0, 10);
  const todayKey = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
  if (todayKey > eventDay) return true;
  if (todayKey < eventDay) return false;
  return today.hour >= 6;
};

const parseClockTime = (value) => {
  const match = String(value || '00:00')
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) throw new Error('Invalid event time');
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = String(match[3] || '').toUpperCase();
  if (period) {
    hour %= 12;
    if (period === 'PM') hour += 12;
  }
  if (hour > 23 || minute > 59) throw new Error('Invalid event time');
  return { hour, minute };
};

const eventStartUtc = ({ eventDate, eventTime, timeZone = 'America/New_York' }) => {
  const [year, month, day] = String(
    eventDate instanceof Date ? eventDate.toISOString() : eventDate
  )
    .slice(0, 10)
    .split('-')
    .map(Number);
  const { hour, minute } = parseClockTime(eventTime);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = new Date(wallClockAsUtc);
  for (let index = 0; index < 2; index += 1) {
    const parts = zonedParts(guess, timeZone);
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    );
    guess = new Date(guess.getTime() + (wallClockAsUtc - represented));
  }
  return guess;
};

const cancellationDeadline = (event) =>
  new Date(
    eventStartUtc({
      eventDate: event.event_date,
      eventTime: event.event_time,
      timeZone: event.event_timezone,
    }).getTime() -
      72 * 60 * 60 * 1000
  );

module.exports = {
  ADMISSIONS_TAX_CODES,
  GENERAL_ADMISSIONS_TAX_CODE,
  PLATFORM_SERVICE_TAX_CODE,
  CUSTOMER_PROCESSING_RATE,
  COORDINATOR_PROCESSING_RATE,
  COORDINATOR_PER_TICKET_FEE,
  getAdmissionsTaxCode,
  getEntityUseCode,
  calculateTicketAmounts,
  assertInventoryAvailable,
  calculateMinimumFoodVendors,
  isScannerAvailable,
  eventStartUtc,
  cancellationDeadline,
  encodeWalletPaymentToken,
};
