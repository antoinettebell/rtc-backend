const { eventStartUtc } = require('./event-ticket-helper');

const AWARD_REVOCATION_HOURS = 72;

const getMarketplaceAwardRevocationDecision = ({
  event,
  vendorPaymentStatus = null,
  now = new Date(),
} = {}) => {
  const normalizedPaymentStatus = String(vendorPaymentStatus || '').toUpperCase();
  if (normalizedPaymentStatus === 'PAID') {
    return {
      canRevoke: false,
      code: 'PROCESSOR_REFUND_REQUIRED',
      cutoffAt: null,
    };
  }
  if (normalizedPaymentStatus === 'PROCESSING') {
    return { canRevoke: false, code: 'PAYMENT_PROCESSING', cutoffAt: null };
  }

  let startAt;
  try {
    startAt = eventStartUtc({
      eventDate: event?.event_date || event?.event_start_date,
      eventTime: event?.event_time || event?.event_start_time,
      timeZone: event?.event_timezone || 'America/New_York',
    });
    if (Number.isNaN(startAt.getTime())) throw new Error('Invalid event start');
  } catch (error) {
    return { canRevoke: false, code: 'EVENT_TIME_UNAVAILABLE', cutoffAt: null };
  }

  const cutoffAt = new Date(
    startAt.getTime() - AWARD_REVOCATION_HOURS * 60 * 60 * 1000
  );
  if (new Date(now).getTime() >= cutoffAt.getTime()) {
    return { canRevoke: false, code: 'REVOCATION_WINDOW_CLOSED', cutoffAt };
  }

  return { canRevoke: true, code: 'AVAILABLE', cutoffAt };
};

const getMarketplaceAwardRevocationError = (decision) => {
  if (decision.code === 'PROCESSOR_REFUND_REQUIRED') {
    return 'A paid vendor fee requires a verified processor refund before this award can be revoked.';
  }
  if (decision.code === 'REVOCATION_WINDOW_CLOSED') {
    return 'Awards cannot be revoked at or within 72 hours of the event start.';
  }
  if (decision.code === 'PAYMENT_PROCESSING') {
    return 'The vendor fee payment is still processing. Try again after its final processor status is known.';
  }
  return 'The event start time could not be verified for award revocation.';
};

module.exports = {
  AWARD_REVOCATION_HOURS,
  getMarketplaceAwardRevocationDecision,
  getMarketplaceAwardRevocationError,
};
