const CyberSource = require('cybersource-rest-client');
const crypto = require('crypto');

const SUCCESS_STATUSES = new Set(['AUTHORIZED', 'PENDING', 'TRANSMITTED', 'SETTLED', 'SUCCEEDED', 'COMPLETED']);
const firstConfiguredValue = (...values) => values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
const isSandboxEnvironment = () => /^(sandbox|test|testing|development|dev)$/i.test(String(process.env.CYBERSOURCE_GOOGLE_PAY_ENV || ''));

const getConfig = (correlationId = null) => {
  const config = {
    authenticationType: 'jwt',
    jwtKeyType: 'SHARED_SECRET',
    merchantID: process.env.CYBERSOURCE_GOOGLE_PAY_MERCHANT_ID,
    merchantKeyId: process.env.CYBERSOURCE_GOOGLE_PAY_REST_KEY_ID,
    merchantsecretKey: process.env.CYBERSOURCE_GOOGLE_PAY_REST_SHARED_SECRET,
    runEnvironment: isSandboxEnvironment() ? 'apitest.cybersource.com' : 'api.cybersource.com',
    logConfiguration: { enableLog: false, enableMasking: true },
  };
  if (correlationId) config.defaultHeaders = { 'v-c-correlation-id': correlationId };
  return config;
};

const assertConfigured = (config) => {
  const missing = [
    ['CYBERSOURCE_GOOGLE_PAY_MERCHANT_ID', config.merchantID],
    ['CYBERSOURCE_GOOGLE_PAY_REST_KEY_ID', config.merchantKeyId],
    ['CYBERSOURCE_GOOGLE_PAY_REST_SHARED_SECRET', config.merchantsecretKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const error = new Error(`CyberSource Google Pay is not configured: ${missing.join(', ')}`);
    error.code = 'CYBERSOURCE_GOOGLE_PAY_NOT_CONFIGURED';
    throw error;
  }
};

const encodeGooglePaymentData = (paymentData) => {
  if (typeof paymentData !== 'string' || !paymentData.trim()) {
    const error = new Error('Google Pay payment data is required.');
    error.code = 'GOOGLE_PAY_TOKEN_MISSING';
    throw error;
  }
  return Buffer.from(paymentData, 'utf8').toString('base64');
};

const billingAddressFields = (billingAddress) => {
  if (!billingAddress || typeof billingAddress !== 'object' || Array.isArray(billingAddress)) return {};
  const address = {};
  ['address1', 'locality', 'administrativeArea', 'postalCode'].forEach((field) => {
    const value = typeof billingAddress[field] === 'string' ? billingAddress[field].trim() : '';
    if (value) address[field] = value;
  });
  const country = typeof billingAddress.country === 'string' ? billingAddress.country.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(country)) address.country = country;
  return address;
};

const buildRequest = ({ paymentData, amount, referenceCode, firstName, lastName, email, phone, billingAddress }) => ({
  clientReferenceInformation: { code: String(referenceCode || `GOOGLE-${Date.now()}`).slice(0, 50) },
  processingInformation: { capture: true, paymentSolution: '012' },
  paymentInformation: { fluidData: { value: encodeGooglePaymentData(paymentData) } },
  orderInformation: {
    amountDetails: { totalAmount: Number(Number(amount || 0).toFixed(2)).toFixed(2), currency: 'USD' },
    billTo: {
      firstName: firstName || 'Customer', lastName: lastName || 'Customer',
      ...(email ? { email } : {}), ...(phone ? { phoneNumber: phone } : {}), ...billingAddressFields(billingAddress),
    },
  },
});

const parseBody = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return null; }
};

const failureDetails = (error) => {
  const response = error?.response || error?.errorResponse || error?.responseData || {};
  const body = parseBody(
    response.body || response.data || response.text || response.responseBody ||
    error?.body || error?.data || error?.text
  ) || {};
  const details = [
    ...(Array.isArray(body.details) ? body.details : []),
    ...(Array.isArray(body?._embedded?.errors) ? body._embedded.errors : []),
  ];
  return {
    status: response.status || response.statusCode || error?.status || error?.statusCode
      ? String(response.status || response.statusCode || error?.status || error?.statusCode)
      : null,
    reason: body.reason || body.code || error?.reason || error?.code || 'CYBERSOURCE_GOOGLE_PAY_FAILED',
    missing_fields: details.filter((entry) => entry?.reason === 'MISSING_FIELD').map((entry) => entry.field).filter(Boolean),
  };
};

const chargeGooglePay = async (details, { sdk = CyberSource } = {}) => {
  const correlationId = crypto.randomUUID();
  try {
    const config = getConfig(correlationId);
    assertConfigured(config);
    const request = sdk.CreatePaymentRequest.constructFromObject(buildRequest(details));
    const response = await new Promise((resolve, reject) => {
      new sdk.PaymentsApi(config).createPayment(request, (error, data, metadata) => {
        if (error) {
          if (metadata && !error.response) error.response = metadata;
          reject(error);
        } else resolve(data || {});
      });
    });
    const status = String(response.status || '').toUpperCase();
    if (!response.id || !SUCCESS_STATUSES.has(status)) {
      console.error('[CyberSourceGooglePay] payment_failed', JSON.stringify({ stage: 'charge_result', status: status || null, reason: status || 'CYBERSOURCE_GOOGLE_PAY_FAILED', missing_fields: [] }));
      return { success: false, env: isSandboxEnvironment() ? 'sandbox' : 'production', code: status || 'CYBERSOURCE_GOOGLE_PAY_FAILED', message: 'Google Pay could not be approved. Please try another payment method.', transactionId: response.id || null, accountType: 'GOOGLE_PAY', correlationId };
    }
    return { success: true, env: isSandboxEnvironment() ? 'sandbox' : 'production', code: status, message: 'Payment approved.', transactionId: response.id, authCode: response.processorInformation?.approvalCode || null, accountType: 'GOOGLE_PAY', correlationId };
  } catch (error) {
    if (['CYBERSOURCE_GOOGLE_PAY_NOT_CONFIGURED', 'GOOGLE_PAY_TOKEN_MISSING'].includes(error?.code)) throw error;
    const diagnostic = failureDetails(error);
    console.error('[CyberSourceGooglePay] payment_failed', JSON.stringify({ stage: 'charge_result', ...diagnostic }));
    return { success: false, env: isSandboxEnvironment() ? 'sandbox' : 'production', code: diagnostic.reason, message: 'Google Pay could not be approved. Please try another payment method.', transactionId: null, accountType: 'GOOGLE_PAY', correlationId };
  }
};

module.exports = { SUCCESS_STATUSES, billingAddressFields, buildRequest, chargeGooglePay, encodeGooglePaymentData, getConfig };
