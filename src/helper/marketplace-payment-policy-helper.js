const FINAL_EVENT_METHODS = {
  CUSTOMER: ['APPLE_PAY', 'GOOGLE_PAY'],
  VENDOR: ['CASH', 'TAP_TO_PAY'],
};

const isMarketplacePaymentMethodAllowed = ({ paymentType, userType, paymentMethod }) => {
  if (paymentType === 'FINAL_EVENT_PAYMENT') {
    return (FINAL_EVENT_METHODS[userType] || []).includes(paymentMethod);
  }
  return ['APPLE_PAY', 'GOOGLE_PAY'].includes(paymentMethod);
};

module.exports = {
  FINAL_EVENT_METHODS,
  isMarketplacePaymentMethodAllowed,
};
