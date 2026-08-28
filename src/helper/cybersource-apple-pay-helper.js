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
    logConfiguration: {
      enableLog: false,
      enableMasking: true,
    },
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

// Keep temporary diagnostics useful without ever emitting Apple Pay payment data,
// credentials, authorization headers, or complete provider payloads.
const sanitizeDiagnosticText = (value) => String(value || '')
  .replace(/(authorization|token|secret|paymentdata|fluiddata|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
  .replace(/eyJ[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+){1,2}/g, '[REDACTED_JWT]')
  .slice(0, 1200);

const safeObjectKeys = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).slice(0, 40);
};

const isSensitiveDiagnosticKey = (key) =>
  /(authorization|token|secret|paymentdata|fluiddata|credential|card)/i.test(String(key));

const safeSerializedBodyKeys = (value) => {
  if (!value) return [];
  if (typeof value === 'object') {
    return safeObjectKeys(value).filter((key) => !isSensitiveDiagnosticKey(key));
  }
  try {
    return safeObjectKeys(JSON.parse(String(value)))
      .filter((key) => !isSensitiveDiagnosticKey(key));
  } catch (_error) {
    return [];
  }
};

const safePrimitiveDiagnosticValue = (value) => {
  if (value === undefined || value === null) return null;
  return sanitizeDiagnosticText(value);
};

const parseJsonObjectSafely = (value) => {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_error) {
    return null;
  }
};

const safeValidationEntry = (entry) => {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const result = {};
  ['code', 'message', 'field', 'reason'].forEach((key) => {
    const value = safePrimitiveDiagnosticValue(entry[key]);
    if (value !== null) result[key] = value;
  });
  return Object.keys(result).length ? result : null;
};

const safeValidationEntries = (entries) => {
  const values = Array.isArray(entries) ? entries : (entries ? [entries] : []);
  return values.slice(0, 20).map(safeValidationEntry).filter(Boolean);
};

const cybersourceValidationDiagnostics = (responseText) => {
  const parsed = parseJsonObjectSafely(responseText);
  if (!parsed) return null;
  const error = parsed.error && typeof parsed.error === 'object' && !Array.isArray(parsed.error)
    ? parsed.error
    : parsed;
  return {
    code: safePrimitiveDiagnosticValue(error.code),
    message: safePrimitiveDiagnosticValue(error.message),
    field: safePrimitiveDiagnosticValue(error.field),
    reason: safePrimitiveDiagnosticValue(error.reason),
    details: safeValidationEntries(error.details || parsed.details),
    embedded_errors: safeValidationEntries(
      error._embedded?.errors || parsed._embedded?.errors
    ),
  };
};

const callbackFailureDiagnostics = ({ error, data, response }) => {
  const errorResponse = error?.response;
  const errorHeaders = errorResponse?.headers || errorResponse?.header || error?.headers || error?.header;
  const responseHeaders = response?.headers || response?.header;
  const config = getConfig();
  return {
    callback_error_type: typeof error,
    callback_error_keys: safeObjectKeys(error),
    callback_error_fields: {
      status: safePrimitiveDiagnosticValue(error?.status),
      statusCode: safePrimitiveDiagnosticValue(error?.statusCode),
      code: safePrimitiveDiagnosticValue(error?.code),
      reason: safePrimitiveDiagnosticValue(error?.reason),
      response_body_keys: safeSerializedBodyKeys(
        errorResponse?.body || errorResponse?.data || errorResponse?.text
      ),
      response_header_keys: safeObjectKeys(errorHeaders),
      v_c_correlation_id: safeHeaderValue(errorHeaders, ['v-c-correlation-id']),
      x_requestid: safeHeaderValue(errorHeaders, ['x-requestid', 'x-request-id']),
      validation: cybersourceValidationDiagnostics(errorResponse?.text),
    },
    callback_data_keys: safeObjectKeys(data),
    callback_response_status: safePrimitiveDiagnosticValue(response?.status || response?.statusCode),
    callback_response_header_keys: safeObjectKeys(responseHeaders),
    callback_response_v_c_correlation_id: safeHeaderValue(
      responseHeaders,
      ['v-c-correlation-id']
    ),
    callback_response_x_requestid: safeHeaderValue(
      responseHeaders,
      ['x-requestid', 'x-request-id']
    ),
    configured_environment: isSandboxEnvironment() ? 'sandbox' : 'production',
    configured_credentials_present: {
      merchant_id: Boolean(config.merchantID),
      key_id: Boolean(config.merchantKeyId),
      shared_secret: Boolean(config.merchantsecretKey),
    },
  };
};

const sanitizedStack = (error) => {
  if (!error?.stack) return null;
  return String(error.stack)
    .split('\n')
    .filter((line, index) => index === 0 || /cybersource-apple-pay-helper|cybersource-rest-client/.test(line))
    .slice(0, 10)
    .map(sanitizeDiagnosticText)
    .join('\n') || null;
};

const withLocalFailureLocation = (error, location) => {
  const target = error instanceof Error
    ? error
    : new Error(error?.message || 'CyberSource SDK callback returned a non-Error failure');
  if (!target.cybersourceApplePayLocalFailureLocation) {
    target.cybersourceApplePayLocalFailureLocation = location;
  }
  return target;
};

const createPayment = (request, { sdk = CyberSource, correlationId = null } = {}) => {
  let config;
  let api;
  let requestBody;
  try {
    config = getConfig(correlationId);
    assertConfigured(config);
    api = new sdk.PaymentsApi(config);
    requestBody = sdk.CreatePaymentRequest.constructFromObject(request);
  } catch (error) {
    throw withLocalFailureLocation(error, 'createPayment: PaymentsApi constructor or request model construction');
  }
  return new Promise((resolve, reject) => {
    try {
      api.createPayment(requestBody, (error, data, response) => {
        const metadata = responseMetadata(response);
        if (error) {
          const wrappedError = withLocalFailureLocation(
            error,
            'createPayment: PaymentsApi.createPayment callback'
          );
          Object.defineProperty(wrappedError, 'cybersourceApplePayCallbackDiagnostics', {
            value: callbackFailureDiagnostics({ error, data, response }),
            enumerable: false,
            configurable: true,
          });
          // The SDK supplies the HTTP response as the third callback argument.
          // Preserve only its metadata for safe downstream diagnostics.
          if (metadata && !wrappedError.response) wrappedError.response = metadata;
          return reject(wrappedError);
        }
        return resolve({ data: data || {}, metadata });
      });
    } catch (error) {
      reject(withLocalFailureLocation(error, 'createPayment: PaymentsApi.createPayment invocation'));
    }
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
  const headers = error?.response?.headers || error?.response?.header || error?.headers || error?.header;
  const isTypeError = error?.name === 'TypeError';
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
    sdk_failure_message: isTypeError ? sanitizeDiagnosticText(error.message) : null,
    sdk_failure_stack: isTypeError ? sanitizedStack(error) : null,
    local_failure_location: error?.cybersourceApplePayLocalFailureLocation || null,
    callback_diagnostics: error?.cybersourceApplePayCallbackDiagnostics || null,
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
    let request;
    try {
      request = buildRequest(details);
    } catch (error) {
      throw withLocalFailureLocation(error, 'chargeApplePay: buildRequest');
    }
    const { data: response } = await createPayment(request, {
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
