const assert = require('assert');
const GooglePay = require('./cybersource-google-pay-helper');

const original = {
  CYBERSOURCE_ENVIRONMENT: process.env.CYBERSOURCE_ENVIRONMENT,
  CYBERSOURCE_MERCHANT_ID: process.env.CYBERSOURCE_MERCHANT_ID,
  CYBERSOURCE_REST_KEY_ID: process.env.CYBERSOURCE_REST_KEY_ID,
  CYBERSOURCE_REST_SHARED_SECRET: process.env.CYBERSOURCE_REST_SHARED_SECRET,
};

process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
process.env.CYBERSOURCE_MERCHANT_ID = 'test-merchant';
process.env.CYBERSOURCE_REST_KEY_ID = 'test-key';
process.env.CYBERSOURCE_REST_SHARED_SECRET = 'test-secret';

let request;
const approvedSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    createPayment(input, callback) { request = input; callback(null, { id: 'payment-1', status: 'AUTHORIZED' }); }
  },
};
const missingAddressSdk = {
  CreatePaymentRequest: { constructFromObject: (value) => value },
  PaymentsApi: class PaymentsApi {
    createPayment(_input, callback) {
      callback({
        status: 400,
        response: {
          text: JSON.stringify({ reason: 'MISSING_FIELD', details: [{ field: 'orderInformation.billTo.address1', reason: 'MISSING_FIELD' }] }),
          headers: { 'x-requestid': 'request-123', 'v-c-correlation-id': 'provider-correlation-123' },
        },
      });
    }
  },
};

(async () => {
  try {
    const rawToken = '{"encrypted":"wallet-data"}';
    const result = await GooglePay.chargeGooglePay({
      paymentData: rawToken, amount: '5.10', referenceCode: 'google-pay-test', firstName: 'Test', lastName: 'Customer', email: 'test@example.com',
      billingAddress: { address1: '1 Test Street', locality: 'Test City', administrativeArea: 'NY', postalCode: '10001', country: 'us' },
    }, { sdk: approvedSdk });
    assert.strictEqual(result.success, true);
    assert.strictEqual(request.processingInformation.paymentSolution, '012');
    assert.strictEqual(Buffer.from(request.paymentInformation.fluidData.value, 'base64').toString('utf8'), rawToken);
    assert.deepStrictEqual(request.orderInformation.billTo, { firstName: 'Test', lastName: 'Customer', email: 'test@example.com', address1: '1 Test Street', locality: 'Test City', administrativeArea: 'NY', postalCode: '10001', country: 'US' });
    const logs = []; const originalError = console.error; console.error = (...args) => logs.push(args);
    try { await GooglePay.chargeGooglePay({ paymentData: rawToken, amount: 1 }, { sdk: missingAddressSdk }); } finally { console.error = originalError; }
    const diagnostic = JSON.parse(logs.find(([tag]) => tag === '[CyberSourceGooglePay] payment_failed')[1]);
    assert.deepStrictEqual(
      {
        stage: diagnostic.stage,
        status: diagnostic.status,
        reason: diagnostic.reason,
        missing_fields: diagnostic.missing_fields,
        cybersource_request_id: diagnostic.cybersource_request_id,
        cybersource_correlation_id: diagnostic.cybersource_correlation_id,
        correlation_id_present: typeof diagnostic.correlation_id === 'string' && diagnostic.correlation_id.length > 0,
      },
      {
        stage: 'charge_result',
        status: '400',
        reason: 'MISSING_FIELD',
        missing_fields: ['orderInformation.billTo.address1'],
        cybersource_request_id: 'request-123',
        cybersource_correlation_id: 'provider-correlation-123',
        correlation_id_present: true,
      }
    );
    console.log('CyberSource Google Pay helper tests passed');
  } finally {
    Object.entries(original).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
