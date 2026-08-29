const CyberSource = require('cybersource-rest-client');
const ApplePay = require('./cybersource-apple-pay-helper');
const GooglePay = require('./cybersource-google-pay-helper');
const TapToPay = require('./cybersource-payment-helper');

const configFor = (paymentMethod) => {
  if (paymentMethod === 'GOOGLE_PAY') return GooglePay.getConfig();
  if (paymentMethod === 'TAP_TO_PAY') return TapToPay.getConfig();
  return ApplePay.getConfig();
};

const processRefund = async ({ transactionId, amount, paymentMethod = 'APPLE_PAY' }, { sdk = CyberSource } = {}) => {
  if (!transactionId) throw new Error('CyberSource transaction ID is required for refund.');
  const request = { orderInformation: { amountDetails: { totalAmount: Number(Number(amount || 0).toFixed(2)).toFixed(2), currency: 'USD' } } };
  const response = await new Promise((resolve, reject) => {
    const api = new sdk.RefundApi(configFor(paymentMethod));
    api.refundPayment(sdk.RefundPaymentRequest.constructFromObject(request), String(transactionId), (error, data) => error ? reject(error) : resolve(data || {}));
  });
  return {
    success: ['REFUNDED', 'PENDING', 'TRANSMITTED', 'SUCCEEDED'].includes(String(response.status || '').toUpperCase()),
    refundTransactionId: response.id || null,
    originalTransactionId: String(transactionId),
    mode: 'refund',
    message: response.status || 'Refund submitted',
  };
};

module.exports = { processRefund };
