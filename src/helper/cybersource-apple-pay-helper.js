const CyberSource = require('cybersource-rest-client');
const crypto = require('crypto');

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

const getConfig = (correlationId = null) => {
  const config = {
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
  };

  // This gives CyberSource support a request-bound value to trace without
  // including payment data, credentials, or other sensitive request content.
  if (correlationId) {
    config.defaultHeaders = { 'v-c-correlation-id': correlationId };
  }

  return config;
};

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

const responseMetadata = (response) => {
  if (!response || typeof response !== 'object') return null;
  return {
    status: response.status || response.statusCode || null,
    headers: response.headers || null,
    body: response.body || response.data || null,
    data: response.data || response.body || null,
  };
};

const createPayment = (request, { sdk = CyberSource, correlationId = null } = {}) => {
  const config = getConfig(correlationId);
  assertConfigured(config);
  const api = new sdk.PaymentsApi(config);
  const requestBody = sdk.CreatePaymentRequest.constructFromObject(request);
  return new Promise((resolve, reject) => {
    api.createPayment(requestBody, (error, data, response) => {
      const metadata = responseMetadata(response);
      if (error) {
        // The SDK supplies the HTTP response as the third callback argument.
        // Preserve only its metadata for safe downstream diagnostics.
        if (metadata && !error.response) error.response = metadata;
        return reject(error);
      }
      return resolve({ data: data || {}, metadata });
    });
  });
};

const newCorrelationId = () => crypto.randomUUID();

const safeHeaderValue = (headers, names) => {
  if (!headers || typeof headers !== 'object') return null;
  const matchedName = Object.keys(headers).find((headerName) =>
    names.includes(String(headerName).toLowerCase())
  );
  const value = matchedName ? headers[matchedName] : null;
  return value === undefined || value === null ? null : String(value);
};

const safeProviderReason = (error) => {
  const body = error?.response?.body || error?.response?.data || {};
  const value = body?.reason || body?.code || error?.code || error?.status;
  return value === undefined || value === null ? 'CYBERSOURCE_APPLE_PAY_FAILED' : String(value);
};

const safeSdkFailureClass = (error) => {
  const code = String(error?.code || '').trim().toUpperCase();
  if (['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
    return code;
  }
  const message = String(error?.message || '');
  if (/failed to decrypt error response/i.test(message)) return 'SDK_RESPONSE_UNAVAILABLE';
  if (/(certificate|tls|ssl)/i.test(message)) return 'TLS_OR_CERTIFICATE_ERROR';
  if (/timeout/i.test(message)) return 'REQUEST_TIMEOUT';
  return error?.name ? String(error.name).slice(0, 80) : 'SDK_ERROR';
};

const logProviderFailure = ({ correlationId, error, status, reason }) => {
  const headers = error?.response?.headers || error?.headers;
  // Do not log the Apple Pay token, credentials, request body, or full provider response.
  console.error('[CyberSourceApplePay] payment_failed', {
    correlation_id: correlationId,
    status: status || error?.response?.status || error?.status || null,
    reason: reason || safeProviderReason(error),
    cybersource_request_id: safeHeaderValue(headers, [
      'v-c-correlation-id',
      'x-correlation-id',
      'x-request-id',
      'x-requestid',
      'request-id',
    ]),
    sdk_failure_class: error ? safeSdkFailureClass(error) : null,
  });
};

const providerFailure = (error, correlationId = newCorrelationId()) => {
  const reason = safeProviderReason(error);
  logProviderFailure({ correlationId, error, reason });
  return {
  success: false,
  env: isSandboxEnvironment() ? 'sandbox' : 'production',
  code: reason,
  message: 'Apple Pay could not be approved. Please try another payment method.',
  transactionId: null,
  authCode: null,
  invoiceNumber: null,
  accountNumber: null,
  accountType: 'APPLE_PAY',
  correlationId,
  };
};

const chargeApplePay = async (details, options = {}) => {
  const correlationId = newCorrelationId();
  try {
    const { data: response } = await createPayment(buildRequest(details), {
      ...options,
      correlationId,
    });
    const status = String(response.status || '').toUpperCase();
    const success = Boolean(response.id) && SUCCESS_STATUSES.has(status);
    if (!success) {
      logProviderFailure({
        correlationId,
        status,
        reason: status || 'CYBERSOURCE_APPLE_PAY_FAILED',
      });
      return {
        success: false,
        env: isSandboxEnvironment() ? 'sandbox' : 'production',
        code: status || 'CYBERSOURCE_APPLE_PAY_FAILED',
        message: 'Apple Pay could not be approved. Please try another payment method.',
        transactionId: response.id || null,
        authCode: null,
        invoiceNumber: null,
        accountNumber: null,
        accountType: 'APPLE_PAY',
        correlationId,
      };
    }
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
    return providerFailure(error, correlationId);
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
