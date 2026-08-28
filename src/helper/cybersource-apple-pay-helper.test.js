const assert = require('assert');
const ApplePay = require('./cybersource-apple-pay-helper');

const original = {
  CYBERSOURCE_APPLE_PAY_ENV: process.env.CYBERSOURCE_APPLE_PAY_ENV,
  CYBERSOURCE_APPLE_PAY_MERCHANT_ID: process.env.CYBERSOURCE_APPLE_PAY_MERCHANT_ID,
  CYBERSOURCE_REST_KEY_ID: process.env.CYBERSOURCE_REST_KEY_ID,
  CYBERSOURCE_REST_SHARED_SECRET: process.env.CYBERSOURCE_REST_SHARED_SECRET,
};

process.env.CYBERSOURCE_APPLE_PAY_ENV = 'sandbox';
process.env.CYBERSOURCE_APPLE_PAY_MERCHANT_ID = 'test-merchant';
process.env.CYBERSOURCE_REST_KEY_ID = 'test-key';
process.env.CYBERSOURCE_REST_SHARED_SECRET = 'test-secret';

let capturedRequest;
let capturedConfig;
const approvedSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    constructor(config) { capturedConfig = config; }
    createPayment(request, callback) {
      capturedRequest = request;
      callback(null, {
        id: 'cybs-payment-1',
        status: 'PENDING',
        processorInformation: { approvalCode: 'APPROVED' },
      }, { status: 201, headers: { 'v-c-correlation-id': 'provider-correlation' } });
    }
  },
};

const declinedSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    createPayment(_request, callback) {
      callback(null, { id: 'cybs-payment-2', status: 'DECLINED' });
    }
  },
};

const responseErrorSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    createPayment(_request, callback) {
      const error = new Error('Provider rejected the request');
      callback(error, null, {
        status: 422,
        headers: { 'x-requestid': 'provider-request-id' },
        body: { reason: 'INVALID_REQUEST' },
      });
    }
  },
};

const compatibilityObjectErrorSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    createPayment(_request, callback) {
      callback({
        status: 422,
        code: 'INVALID_REQUEST',
        reason: 'MISSING_FIELD',
        response: {
          status: 422,
          header: { 'x-request-id': 'provider-request-id' },
          text: JSON.stringify({
            id: 'provider-error-id',
            submitTimeUtc: '2026-08-28T00:00:00Z',
            status: 'INVALID_REQUEST',
            reason: 'MISSING_FIELD',
            message: 'Declined - The request is missing one or more fields',
            details: [
              { field: 'orderInformation.billTo.locality', reason: 'MISSING_FIELD' },
              { field: 'orderInformation.billTo.address1', reason: 'MISSING_FIELD' },
              { field: 'orderInformation.billTo.country', reason: 'MISSING_FIELD' },
            ],
            address1: 'billing-address-value-must-not-appear-in-diagnostics',
            paymentToken: 'must-not-appear-in-diagnostics',
          }),
        },
      }, null, {
        status: 422,
        header: { 'x-request-id': 'provider-request-id' },
      });
    }
  },
};

const constructorTypeErrorSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    constructor() {
      throw new TypeError('Cannot read properties of undefined (reading enableLog)');
    }
  },
};

const restore = () => Object.entries(original).forEach(([key, value]) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
});

(async () => {
  try {
    const token = { version: 'EC_v1', data: 'test-token' };
    const billingAddress = {
      address1: '123 Test Street',
      locality: 'Test City',
      administrativeArea: 'NY',
      postalCode: '10001',
      country: 'us',
    };
    const requestWithBillingAddress = ApplePay.buildRequest({
      paymentData: token,
      amount: 3.43,
      referenceCode: 'ticket-order-1',
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phone: '5551234567',
      billingAddress,
    });
    assert.deepStrictEqual(requestWithBillingAddress.orderInformation.billTo, {
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
      phoneNumber: '5551234567',
      address1: '123 Test Street',
      locality: 'Test City',
      administrativeArea: 'NY',
      postalCode: '10001',
      country: 'US',
    });
    const result = await ApplePay.chargeApplePay({
      paymentData: token,
      amount: 3.43,
      referenceCode: 'ticket-order-1',
      firstName: 'Test',
      lastName: 'Customer',
      email: 'test@example.com',
    }, { sdk: approvedSdk });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.transactionId, 'cybs-payment-1');
    assert.strictEqual(capturedConfig.runEnvironment, 'apitest.cybersource.com');
    assert.match(capturedConfig.defaultHeaders['v-c-correlation-id'], /^[0-9a-f-]{36}$/i);
    assert.strictEqual(capturedRequest.processingInformation.paymentSolution, '001');
    assert.strictEqual(capturedRequest.paymentInformation.fluidData.descriptor, ApplePay.APPLE_PAY_DESCRIPTOR);
    assert.deepStrictEqual(
      JSON.parse(Buffer.from(capturedRequest.paymentInformation.fluidData.value, 'base64').toString('utf8')),
      token
    );
    const declined = await ApplePay.chargeApplePay({ paymentData: token, amount: 1 }, { sdk: declinedSdk });
    assert.strictEqual(declined.success, false);
    assert.strictEqual(declined.transactionId, 'cybs-payment-2');
    const responseError = await ApplePay.chargeApplePay({ paymentData: token, amount: 1 }, {
      sdk: responseErrorSdk,
    });
    assert.strictEqual(responseError.success, false);
    assert.strictEqual(responseError.code, 'INVALID_REQUEST');

    const loggedFailures = [];
    const originalConsoleError = console.error;
    console.error = (...args) => loggedFailures.push(args);
    try {
      const constructorTypeError = await ApplePay.chargeApplePay({
        paymentData: { data: 'must-not-appear-in-diagnostics' },
        amount: 1,
      }, { sdk: constructorTypeErrorSdk });
      assert.strictEqual(constructorTypeError.success, false);

      const compatibilityObjectError = await ApplePay.chargeApplePay({
        paymentData: { data: 'must-not-appear-in-diagnostics' },
        amount: 1,
      }, { sdk: compatibilityObjectErrorSdk });
      assert.strictEqual(compatibilityObjectError.success, false);
    } finally {
      console.error = originalConsoleError;
    }
    const diagnostics = loggedFailures
      .filter(([tag]) => tag === '[CyberSourceApplePay] payment_failed')
      .map(([, details]) => {
        assert.strictEqual(typeof details, 'string');
        assert.doesNotMatch(details, /\[Object\]/);
        return JSON.parse(details);
      });
    const diagnostic = diagnostics.find((details) => details.sdk_failure_class === 'TypeError');
    assert.strictEqual(diagnostic.sdk_failure_class, 'TypeError');
    assert.match(diagnostic.sdk_failure_message, /enableLog/);
    assert.strictEqual(
      diagnostic.local_failure_location,
      'createPayment: PaymentsApi constructor or request model construction'
    );
    assert.doesNotMatch(JSON.stringify(diagnostic), /must-not-appear-in-diagnostics/);

    const compatibilityDiagnostic = diagnostics.find((details) => (
      details.callback_diagnostics?.callback_error_fields?.reason === 'MISSING_FIELD'
    ));
    assert(compatibilityDiagnostic, 'expected safe diagnostics for SDK compatibility object');
    assert.strictEqual(compatibilityDiagnostic.callback_diagnostics.callback_error_type, 'object');
    assert.deepStrictEqual(
      compatibilityDiagnostic.callback_diagnostics.callback_error_fields.response_body_keys.sort(),
      ['address1', 'details', 'id', 'message', 'reason', 'status', 'submitTimeUtc']
    );
    assert.strictEqual(
      compatibilityDiagnostic.callback_diagnostics.callback_error_fields.v_c_correlation_id,
      null
    );
    assert.strictEqual(
      compatibilityDiagnostic.callback_diagnostics.callback_error_fields.x_requestid,
      'provider-request-id'
    );
    assert.deepStrictEqual(
      compatibilityDiagnostic.callback_diagnostics.callback_error_fields.validation,
      {
        code: null,
        message: 'Declined - The request is missing one or more fields',
        field: null,
        reason: 'MISSING_FIELD',
        details: [
          { field: 'orderInformation.billTo.locality', reason: 'MISSING_FIELD' },
          { field: 'orderInformation.billTo.address1', reason: 'MISSING_FIELD' },
          { field: 'orderInformation.billTo.country', reason: 'MISSING_FIELD' },
        ],
        embedded_errors: [],
      }
    );
    assert.deepStrictEqual(
      compatibilityDiagnostic.callback_diagnostics.callback_response_header_keys,
      ['x-request-id']
    );
    assert.strictEqual(
      compatibilityDiagnostic.callback_diagnostics.configured_credentials_present.shared_secret,
      true
    );
    assert.doesNotMatch(JSON.stringify(compatibilityDiagnostic), /must-not-appear-in-diagnostics/);
    assert.doesNotMatch(JSON.stringify(compatibilityDiagnostic), /billing-address-value-must-not-appear/);
    console.log('CyberSource Apple Pay helper tests passed');
  } finally {
    restore();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
