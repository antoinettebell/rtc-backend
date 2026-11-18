// Every available payout method requires the supporting bank details.  The
// selected payout method is still preserved; Cash App, PayPal, and Venmo are
// not converted to ACH.
const BANK_METHODS = ['ACH', 'CHECK', 'CASHAPP', 'PAYPAL', 'VENMO'];
const REMITTANCE_METHODS = ['CASHAPP', 'PAYPAL', 'VENMO'];

const buildBankDetailUpdate = (values) => {
  const requiresBankDetails = BANK_METHODS.includes(values.paymentMethod);
  const requiresRemittanceDetails = REMITTANCE_METHODS.includes(
    values.paymentMethod
  );

  return {
    paymentMethod: values.paymentMethod,
    phoneNumber: values.phoneNumber || '',
    ...(requiresBankDetails
      ? {
          accountHolderName: values.accountHolderName,
          bankName: values.bankName,
          accountNumber: values.accountNumber,
          routingNumber: values.routingNumber,
          accountType: values.accountType,
          bankAddressLine1: values.bankAddressLine1,
          bankAddressLine2: values.bankAddressLine2 || '',
          bankCity: values.bankCity,
          bankState: values.bankState,
          bankPostal: values.bankPostal,
          swiftCode: values.swiftCode || '',
          iban: values.iban || '',
        }
      : {}),
    ...(requiresRemittanceDetails
      ? {
          remittanceEmail: values.remittanceEmail,
          currency: values.currency,
          paymentQrCodeUrl: values.paymentQrCodeUrl,
          walletPaymentHandle:
            values.walletPaymentHandle || values.accountHolderName || '',
        }
      : {}),
  };
};

const hydrateLegacyWalletPaymentHandle = (values = {}) => ({
  ...values,
  walletPaymentHandle:
    values.walletPaymentHandle ||
    (REMITTANCE_METHODS.includes(values.paymentMethod)
      ? values.accountHolderName || ''
      : ''),
});

module.exports = {
  buildBankDetailUpdate,
  hydrateLegacyWalletPaymentHandle,
};
