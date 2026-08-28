const CyberSource = require('cybersource-rest-client');

const APPLE_PAY_DESCRIPTOR = 'RklEPUNPTU1PTi5BUFBMRS5JTkFQUC5QQVlNRU5U';
const SUCCESS_STATUSES = new Set([
  'AUTHORIZED',
  'PENDING',
  'TRANSMITTED',
  'SETTLED',
  'SUCCEEDED',
  'COMPLETED',
]);

const firstConfiguredValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');

const isSandboxEnvironment = () =>
  /^(sandbox|test|testing|development|dev)$/i.test(
    String(
      firstConfiguredValue(
        process.env.CYBERSOURCE_APPLE_PAY_ENV,
        process.env.CYBERSOURCE_ENVIRONMENT
      ) || ''
    )
  );

const getConfig = () => ({
  authenticationType: 'jwt',
  jwtKeyType: 'SHARED_SECRET',
  merchantID: firstConfiguredValue(
    process.env.CYBERSOURCE_APPLE_PAY_MERCHANT_ID,
    process.env.CYBERSOURCE_MERCHANT_ID,
    process.env.CYBERSOURCE_TTP_MERCHANT_ID
  ),
  merchantKeyId: process.env.CYBERSOURCE_REST_KEY_ID,
  merchantsecretKey: process.env.CYBERSOURCE_REST_SHARED_SECRET,
  runEnvironment: isSandboxEnvironment()
    ? 'apitest.cybersource.com'
    : 'api.cybersource.com',
  enableLog: false,
});

const assertConfigured = (config) => {
  const missing = [
    ['CYBERSOURCE_APPLE_PAY_MERCHANT_ID or CYBERSOURCE_MERCHANT_ID', config.merchantID],
    ['CYBERSOURCE_REST_KEY_ID', config.merchantKeyId],
    ['CYBERSOURCE_REST_SHARED_SECRET', config.merchantsecretKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const error = new Error(`CyberSource Apple Pay is not configured: ${missing.join(', ')}`);
    error.code = 'CYBERSOURCE_APPLE_PAY_NOT_CONFIGURED';
    throw error;
  }
};

const toMoney = (value) => Number(Number(value || 0).toFixed(2));

const encodeApplePaymentData = (paymentData) => {
  if (!paymentData) {
    const error = new Error('Apple Pay payment data is required.');
    error.code = 'APPLE_PAY_TOKEN_MISSING';
    throw error;
  }
  const serialized = typeof paymentData === 'string'
    ? paymentData
    : JSON.stringify(paymentData);
  return Buffer.from(serialized, 'utf8').toString('base64');
};

const buildRequest = ({ paymentData, amount, referenceCode, firstName, lastName, email }) => ({
  clientReferenceInformation: { code: String(referenceCode || `APPLE-${Date.now()}`).slice(0, 50) },
  processingInformation: {
    capture: true,
    paymentSolution: '001',
  },
  paymentInformation: {
    fluidData: {
      descriptor: APPLE_PAY_DESCRIPTOR,
      encoding: 'Base64',
      value: encodeApplePaymentData(paymentData),
    },
  },
  orderInformation: {
    amountDetails: {
      totalAmount: toMoney(amount).toFixed(2),
      currency: 'USD',
    },
    billTo: {
      firstName: firstName || 'Customer',
      lastName: lastName || 'Customer',
      email: email || undefined,
    },
  },
});

const createPayment = (request, { sdk = CyberSource } = {}) => {
  const config = getConfig();
  assertConfigured(config);
  const api = new sdk.PaymentsApi(config);
  const requestBody = sdk.CreatePaymentRequest.constructFromObject(request);
  return new Promise((resolve, reject) => {
    api.createPayment(requestBody, (error, data) => {
      if (error) return reject(error);
      return resolve(data || {});
    });
  });
};

const providerFailure = (error) => ({
  success: false,
  env: isSandboxEnvironment() ? 'sandbox' : 'production',
  code: String(error?.response?.body?.reason || error?.status || 'CYBERSOURCE_APPLE_PAY_FAILED'),
  message: 'Apple Pay could not be approved. Please try another payment method.',
  transactionId: null,
  authCode: null,
  invoiceNumber: null,
  accountNumber: null,
  accountType: 'APPLE_PAY',
});

const chargeApplePay = async (details, options = {}) => {
  try {
    const response = await createPayment(buildRequest(details), options);
    const status = String(response.status || '').toUpperCase();
    const success = Boolean(response.id) && SUCCESS_STATUSES.has(status);
    return {
      success,
      env: isSandboxEnvironment() ? 'sandbox' : 'production',
      code: status || (success ? 'AUTHORIZED' : 'CYBERSOURCE_APPLE_PAY_FAILED'),
      message: success ? 'Payment approved.' : 'Apple Pay could not be approved. Please try another payment method.',
      transactionId: response.id || null,
      authCode: response.processorInformation?.approvalCode || null,
      invoiceNumber: null,
      accountNumber: null,
      accountType: 'APPLE_PAY',
    };
  } catch (error) {
    if (error?.code === 'CYBERSOURCE_APPLE_PAY_NOT_CONFIGURED' || error?.code === 'APPLE_PAY_TOKEN_MISSING') {
      throw error;
    }
    return providerFailure(error);
  }
};

module.exports = {
  APPLE_PAY_DESCRIPTOR,
  SUCCESS_STATUSES,
  buildRequest,
  chargeApplePay,
  encodeApplePaymentData,
  getConfig,
};
