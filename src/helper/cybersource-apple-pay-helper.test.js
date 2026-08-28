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
      });
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

const restore = () => Object.entries(original).forEach(([key, value]) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
});

(async () => {
  try {
    const token = { version: 'EC_v1', data: 'test-token' };
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
    assert.strictEqual(capturedRequest.processingInformation.paymentSolution, '001');
    assert.strictEqual(capturedRequest.paymentInformation.fluidData.descriptor, ApplePay.APPLE_PAY_DESCRIPTOR);
    assert.deepStrictEqual(
      JSON.parse(Buffer.from(capturedRequest.paymentInformation.fluidData.value, 'base64').toString('utf8')),
      token
    );
    const declined = await ApplePay.chargeApplePay({ paymentData: token, amount: 1 }, { sdk: declinedSdk });
    assert.strictEqual(declined.success, false);
    assert.strictEqual(declined.transactionId, 'cybs-payment-2');
    console.log('CyberSource Apple Pay helper tests passed');
  } finally {
    restore();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
