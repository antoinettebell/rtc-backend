const assert = require('assert');
const {
  COORDINATOR_AWARD_FEE_RATE,
  FINAL_EVENT_PAYMENT_FEE_RATE,
  getCoordinatorAwardFeeAmount,
  getCustomerTicketProcessingFeeAmount,
  getFinalEventPaymentAmounts,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
} = require('./marketplace-regression-test-fees');

assert.equal(COORDINATOR_AWARD_FEE_RATE, 0.035);
assert.equal(FINAL_EVENT_PAYMENT_FEE_RATE, 0.035);
assert.equal(getCoordinatorAwardFeeAmount(4000), 140);
assert.equal(getCustomerTicketProcessingFeeAmount(100), 0.01);
assert.equal(getMarketplaceVendorApplicationCheckoutFeeAmount(60), 0.01);

const awardedBid = { full_bid_amount: 1000 };
assert.deepEqual(getFinalEventPaymentAmounts(awardedBid.full_bid_amount, 25), {
  baseAmount: 1000,
  feeRate: 0.035,
  feeAmount: 35,
  tipAmount: 25,
  totalAmount: 1060,
  coordinatorPayoutAmount: 1025,
});
assert.equal(
  awardedBid.full_bid_amount,
  1000,
  'final-payment calculation must not mutate the awarded bid amount'
);

console.log('marketplace fee calculations passed');
