const assert = require('assert');
const {
  REGRESSION_TEST_TRANSACTION_FEE,
  getCoordinatorAwardFeeAmount,
  getCustomerTicketProcessingFeeAmount,
  getFinalEventPaymentAmounts,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
} = require('./marketplace-regression-test-fees');

assert.equal(REGRESSION_TEST_TRANSACTION_FEE, 0.01);
assert.equal(getCoordinatorAwardFeeAmount(4000), 0.01);
assert.equal(getCustomerTicketProcessingFeeAmount(100), 0.01);
assert.equal(getMarketplaceVendorApplicationCheckoutFeeAmount(60), 0.01);

const awardedBid = { full_bid_amount: 1000 };
assert.deepEqual(getFinalEventPaymentAmounts(awardedBid.full_bid_amount, 25), {
  baseAmount: 0.01,
  tipAmount: 0,
  totalAmount: 0.01,
  coordinatorPayoutAmount: 0.01,
});
assert.equal(
  awardedBid.full_bid_amount,
  1000,
  'the temporary processor override must not mutate the awarded bid amount'
);

console.log('marketplace regression test fee overrides passed');
