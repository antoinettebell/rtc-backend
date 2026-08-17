const MATCHED_APPLICATION_STATUSES = [
  'ACCEPTED',
  'AWARDED',
  'PAYMENT_DUE',
  'PAID',
  'CONFIRMED',
];

const isMarketplaceLocationUnlocked = ({
  bid = null,
  application = null,
  vendorPaymentSatisfied = false,
} = {}) => {
  if (String(bid?.bid_status || '').toUpperCase() === 'AWARDED') {
    return true;
  }
  return (
    MATCHED_APPLICATION_STATUSES.includes(
      String(application?.application_status || '').toUpperCase()
    ) && vendorPaymentSatisfied
  );
};

const isMarketplaceDetailsUnlocked = ({
  matchSatisfied = false,
  scenario = 'NO_PAYMENT',
  coordinatorPaymentSatisfied = false,
  vendorPaymentSatisfied = false,
} = {}) => {
  if (!matchSatisfied) return false;
  if (scenario === 'NO_PAYMENT') return true;
  return coordinatorPaymentSatisfied && vendorPaymentSatisfied;
};

const isEventVendorApplicationUnlocked = (application = {}) => {
  const status = String(application.status || '').toUpperCase();
  if (!MATCHED_APPLICATION_STATUSES.includes(status)) return false;
  if (status === 'PAID') return true;
  if (
    application.checkout_subtotal === null ||
    application.checkout_subtotal === undefined ||
    application.checkout_subtotal === ''
  ) {
    return false;
  }
  const checkoutSubtotal = Number(application.checkout_subtotal);
  return Number.isFinite(checkoutSubtotal) && checkoutSubtotal <= 0;
};

module.exports = {
  isMarketplaceLocationUnlocked,
  isMarketplaceDetailsUnlocked,
  isEventVendorApplicationUnlocked,
};
