const {
  getMarketplaceBudgetGuestCount,
} = require('./marketplace-participation-helper');

const AMENDMENT_STATUSES = [
  'AWAITING_VENDOR',
  'PENDING_REVIEW',
  'ACCEPTED',
  'REJECTED',
];

const OPEN_AMENDMENT_STATUSES = ['AWAITING_VENDOR', 'PENDING_REVIEW'];

const VIP_CAPACITY_LOCK_HOURS = 72;
const VIP_CAPACITY_LOCK_MESSAGE =
  'Event is less or equal to 72hrs away, please contact your vendor directly to discuss possible cost changes.';

const isSolelyPrivateCateredEvent = (event = {}) =>
  String(event.event_visibility || '').toUpperCase() === 'PRIVATE' &&
  event.ticket_sales_enabled !== true &&
  event.fully_catered_event === true;

const getAwardedEventStatus = (event = {}, eventFullyAwarded = false) => {
  if (!eventFullyAwarded) return event.status;
  return isSolelyPrivateCateredEvent(event) ? 'AWARDED' : event.status;
};

const getHoursUntilEventStart = ({ eventTiming, now = new Date() }) => {
  if (!eventTiming?.start_at) return null;
  return (new Date(eventTiming.start_at).getTime() - new Date(now).getTime()) /
    (60 * 60 * 1000);
};

const isVipCapacityIncreaseLocked = ({
  currentCapacity,
  proposedCapacity,
  eventTiming,
  now = new Date(),
}) => {
  if (Number(proposedCapacity) <= Number(currentCapacity || 0)) return false;
  const hoursUntilStart = getHoursUntilEventStart({ eventTiming, now });
  return hoursUntilStart != null && hoursUntilStart <= VIP_CAPACITY_LOCK_HOURS;
};

const getVipAwardAmountField = (bid = {}) => {
  const coverage = String(bid.awarded_coverage || bid.guest_coverage || '').toUpperCase();
  if (coverage === 'VIP') return 'full_bid_amount';
  if (coverage === 'BOTH') return 'vip_catering_amount';
  return null;
};

const isVipAward = (bid = {}) => Boolean(getVipAwardAmountField(bid));

const canRequestVipAwardAmendment = ({ event = {}, awardedBids = [] }) =>
  ['OPEN', 'REOPENED', 'CLOSED', 'AWARDED'].includes(
    String(event.status || '').toUpperCase()
  ) && awardedBids.some(isVipAward);

const attachOpenAwardAmendmentsToBids = (bids = [], amendments = []) => {
  const amendmentByBidId = amendments.reduce((result, amendment) => {
    const bidId = amendment?.original_bid_id;
    if (!bidId || result[bidId]) return result;
    result[bidId] = amendment;
    return result;
  }, {});

  return bids.map((bid) => {
    const amendment = amendmentByBidId[bid.bid_id];
    if (!amendment) return bid;
    return {
      ...bid,
      award_amendment_id: amendment.amendment_id,
      award_amendment_status: amendment.status,
    };
  });
};

const buildAwardedVipGuestCountUpdate = ({
  event = {},
  requestedVipGuestCount,
  requestedBudget,
}) => {
  const eventChanges = { vip_guest_count: requestedVipGuestCount };
  const coordinatorFundsEvent = ['COORDINATOR', 'BOTH'].includes(
    String(event.payment_responsibility || '').toUpperCase()
  );
  if (!coordinatorFundsEvent) return { eventChanges, validationMessage: null };

  const budget = Number(requestedBudget);
  if (!Number.isFinite(budget) || budget <= 0) {
    return {
      eventChanges,
      validationMessage: 'Enter the revised coordinator budget.',
    };
  }

  const minimumBudget = getMarketplaceBudgetGuestCount({
    ...event,
    vip_guest_count: requestedVipGuestCount,
  }) * 25;
  if (budget < minimumBudget) {
    return {
      eventChanges,
      validationMessage: `Budget amount must be at least $${minimumBudget.toFixed(2)} for the paid guest count.`,
    };
  }

  return {
    eventChanges: { ...eventChanges, budgeted_amount: budget },
    validationMessage: null,
  };
};

const buildReplacementBidAmounts = ({ bid = {}, proposedAmount, event = {} }) => {
  const amount = Math.round(Number(proposedAmount) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('INVALID_PROPOSED_AMOUNT');
  }

  const field = getVipAwardAmountField(bid);
  if (!field) throw new Error('VIP_AWARD_REQUIRED');

  if (field === 'full_bid_amount') {
    return { full_bid_amount: amount, total_bid_amount: amount };
  }

  const regularAmount = Number(bid.regular_guest_amount || 0);
  const fullBidAmount = event.fully_catered_event
    ? Math.round((regularAmount + amount) * 100) / 100
    : amount;
  const specialtyAmount = ['DESSERTS', 'DRINKS'].reduce((total, service) => {
    if (!Array.isArray(bid.specialty_services) || !bid.specialty_services.includes(service)) {
      return total;
    }
    const value = service === 'DESSERTS'
      ? bid.dessert_bid_amount
      : bid.drinks_bid_amount;
    return total + Number(value || 0);
  }, 0);

  return {
    vip_catering_amount: amount,
    full_bid_amount: fullBidAmount,
    total_bid_amount: Math.round((fullBidAmount + specialtyAmount) * 100) / 100,
  };
};

module.exports = {
  AMENDMENT_STATUSES,
  OPEN_AMENDMENT_STATUSES,
  VIP_CAPACITY_LOCK_HOURS,
  VIP_CAPACITY_LOCK_MESSAGE,
  attachOpenAwardAmendmentsToBids,
  buildAwardedVipGuestCountUpdate,
  buildReplacementBidAmounts,
  canRequestVipAwardAmendment,
  getAwardedEventStatus,
  getHoursUntilEventStart,
  getVipAwardAmountField,
  isSolelyPrivateCateredEvent,
  isVipAward,
  isVipCapacityIncreaseLocked,
};
