const roundMoney = (value) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

// Marketplace fees are persisted as decimal rates (for example, 0.035 is 3.5%).
const COORDINATOR_AWARD_FEE_RATE = 0.035;
const FINAL_EVENT_PAYMENT_FEE_RATE = 0.035;

const getCoordinatorAwardFeeAmount = (baseAmount) =>
  roundMoney(baseAmount * COORDINATOR_AWARD_FEE_RATE);

// Marketplace Vendor application checkout has no platform surcharge. The
// vendor pays the event's configured fee exactly as entered.
const getMarketplaceVendorApplicationCheckoutFeeAmount = () =>
  0;

// Customer ticket checkout has no default processing surcharge.
const getCustomerTicketProcessingFeeAmount = () =>
  0;

// The coordinator pays the final awarded amount and optional tip. RTC retains
// the 3.5% POS fee, so that fee is excluded from the vendor payout.
const getFinalEventPaymentAmounts = (awardedAmount, requestedTipAmount) => {
  const baseAmount = roundMoney(awardedAmount);
  const tipAmount = roundMoney(requestedTipAmount);
  const feeAmount = roundMoney(baseAmount * FINAL_EVENT_PAYMENT_FEE_RATE);

  return {
    baseAmount,
    feeRate: FINAL_EVENT_PAYMENT_FEE_RATE,
    feeAmount,
    tipAmount,
    totalAmount: roundMoney(baseAmount + feeAmount + tipAmount),
    coordinatorPayoutAmount: roundMoney(baseAmount + tipAmount),
  };
};

module.exports = {
  COORDINATOR_AWARD_FEE_RATE,
  FINAL_EVENT_PAYMENT_FEE_RATE,
  getCoordinatorAwardFeeAmount,
  getCustomerTicketProcessingFeeAmount,
  getFinalEventPaymentAmounts,
  getMarketplaceVendorApplicationCheckoutFeeAmount,
};
