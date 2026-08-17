const isCoordinatorPayableAward = (bid = {}) =>
  bid.bid_status === 'AWARDED' &&
  !bid.award_revoked_at &&
  Number(bid.full_bid_amount || 0) > 0;

const getCoordinatorPaymentCompletion = ({ awardedBids = [], finalPayments = [] } = {}) => {
  const requiredBidIds = awardedBids
    .filter(isCoordinatorPayableAward)
    .map((bid) => String(bid.bid_id));
  const paidBidIds = new Set(
    finalPayments
      .filter(
        (payment) =>
          payment.payment_type === 'FINAL_EVENT_PAYMENT' &&
          payment.payment_status === 'PAID' &&
          payment.bid_id
      )
      .map((payment) => String(payment.bid_id))
  );
  const outstandingBidIds = requiredBidIds.filter((bidId) => !paidBidIds.has(bidId));

  return {
    requiredBidIds,
    outstandingBidIds,
    paymentRequired: requiredBidIds.length > 0,
    allRequiredPaymentsComplete:
      requiredBidIds.length > 0 && outstandingBidIds.length === 0,
  };
};

module.exports = {
  getCoordinatorPaymentCompletion,
  isCoordinatorPayableAward,
};
