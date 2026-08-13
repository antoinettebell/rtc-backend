const REGRESSION_TEST_TRANSACTION_FEE = 0.01;

// TEMPORARY REGRESSION TEST OVERRIDE.
// Production coordinator award fee: roundMoney(baseAmount * 0.015), or 1.5%.
const getCoordinatorAwardFeeAmount = () => REGRESSION_TEST_TRANSACTION_FEE;

// TEMPORARY REGRESSION TEST OVERRIDE.
// Production Marketplace Vendor application checkout fee:
// roundMoney(checkoutSubtotal * 0.035), or 3.5%.
const getMarketplaceVendorApplicationCheckoutFeeAmount = () =>
  REGRESSION_TEST_TRANSACTION_FEE;

// TEMPORARY REGRESSION TEST OVERRIDE.
// Production customer ticket processing fee:
// roundMoney(ticketSubtotal * 0.035), or 3.5%.
const getCustomerTicketProcessingFeeAmount = () =>
  REGRESSION_TEST_TRANSACTION_FEE;

module.exports = {
  REGRESSION_TEST_TRANSACTION_FEE,
  getCoordinatorAwardFeeAmount,
  getCustomerTicketProcessingFeeAmount,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
};
