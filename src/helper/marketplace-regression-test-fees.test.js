const assert = require('assert');
const {
  REGRESSION_TEST_TRANSACTION_FEE,
  getCoordinatorAwardFeeAmount,
  getCustomerTicketProcessingFeeAmount,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
} = require('./marketplace-regression-test-fees');

assert.equal(REGRESSION_TEST_TRANSACTION_FEE, 0.01);
assert.equal(getCoordinatorAwardFeeAmount(4000), 0.01);
assert.equal(getCustomerTicketProcessingFeeAmount(100), 0.01);
assert.equal(getMarketplaceVendorApplicationCheckoutFeeAmount(60), 0.01);

console.log('marketplace regression test fee overrides passed');
