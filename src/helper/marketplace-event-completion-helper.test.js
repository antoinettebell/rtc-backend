const assert = require('assert');
const {
  getCoordinatorPaymentCompletion,
  isCoordinatorPayableAward,
} = require('./marketplace-event-completion-helper');

const awarded = (bidId, amount = 100) => ({
  bid_id: bidId,
  bid_status: 'AWARDED',
  full_bid_amount: amount,
  award_revoked_at: null,
});
const paid = (bidId) => ({
  bid_id: bidId,
  payment_type: 'FINAL_EVENT_PAYMENT',
  payment_status: 'PAID',
});

assert.equal(isCoordinatorPayableAward(awarded('bid-1')), true);
assert.equal(isCoordinatorPayableAward({ ...awarded('bid-1'), bid_status: 'NOT_AWARDED' }), false);
assert.equal(isCoordinatorPayableAward({ ...awarded('bid-1'), award_revoked_at: new Date() }), false);
assert.equal(isCoordinatorPayableAward(awarded('bid-1', 0)), false);

assert.deepStrictEqual(
  getCoordinatorPaymentCompletion({ awardedBids: [], finalPayments: [] }),
  {
    requiredBidIds: [],
    outstandingBidIds: [],
    paymentRequired: false,
    allRequiredPaymentsComplete: false,
  }
);

assert.deepStrictEqual(
  getCoordinatorPaymentCompletion({
    awardedBids: [awarded('bid-1'), awarded('bid-2')],
    finalPayments: [paid('bid-1')],
  }).outstandingBidIds,
  ['bid-2']
);

assert.equal(
  getCoordinatorPaymentCompletion({
    awardedBids: [awarded('bid-1'), awarded('bid-2')],
    finalPayments: [paid('bid-1'), paid('bid-2')],
  }).allRequiredPaymentsComplete,
  true
);

console.log('marketplace event completion helper tests passed');
