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
  buildReplacementBidAmounts,
  canRequestVipAwardAmendment,
  getAwardedEventStatus,
  getHoursUntilEventStart,
  getVipAwardAmountField,
  isSolelyPrivateCateredEvent,
  isVipAward,
  isVipCapacityIncreaseLocked,
};
