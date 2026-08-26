const assert = require('assert');
const CyberSourcePaymentHelper = require('./cybersource-payment-helper');

const originalEnvironment = {
  CYBERSOURCE_ENVIRONMENT: process.env.CYBERSOURCE_ENVIRONMENT,
  CYBERSOURCE_TTP_ENV: process.env.CYBERSOURCE_TTP_ENV,
  CYBERSOURCE_TTP_MERCHANT_ID: process.env.CYBERSOURCE_TTP_MERCHANT_ID,
  CYBERSOURCE_TTP_ENABLED: process.env.CYBERSOURCE_TTP_ENABLED,
  CYBERSOURCE_MERCHANT_ID: process.env.CYBERSOURCE_MERCHANT_ID,
  CYBERSOURCE_REST_KEY_ID: process.env.CYBERSOURCE_REST_KEY_ID,
  CYBERSOURCE_REST_SHARED_SECRET: process.env.CYBERSOURCE_REST_SHARED_SECRET,
};

process.env.CYBERSOURCE_ENVIRONMENT = 'sandbox';
process.env.CYBERSOURCE_MERCHANT_ID = 'test-merchant';
process.env.CYBERSOURCE_REST_KEY_ID = 'test-key';
process.env.CYBERSOURCE_REST_SHARED_SECRET = 'test-secret';
process.env.CYBERSOURCE_TTP_ENABLED = 'true';

const sdkWithTransaction = (transaction) => ({
  TransactionDetailsApi: class TransactionDetailsApi {
    getTransaction(transactionId, callback) {
      callback(null, { ...transaction, id: transactionId });
    }
  },
});

const restoreEnvironment = () => {
  Object.entries(originalEnvironment).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

(async () => {
  try {
    const verified = await CyberSourcePaymentHelper.verifyTransaction(
      {
        transactionId: 'txn-123',
        expectedAmount: 125.5,
        expectedCurrency: 'USD',
        expectedReference: 'payment-123',
      },
      {
        sdk: sdkWithTransaction({
          status: 'AUTHORIZED',
          orderInformation: {
            amountDetails: { totalAmount: '125.50', currency: 'USD' },
          },
          clientReferenceInformation: { code: 'payment-123' },
        }),
      }
    );
    assert.strictEqual(verified.id, 'txn-123');

    await assert.rejects(
      () =>
        CyberSourcePaymentHelper.verifyTransaction(
          { transactionId: 'txn-456', expectedAmount: 20, expectedCurrency: 'USD' },
          {
            sdk: sdkWithTransaction({
              status: 'DECLINED',
              orderInformation: {
                amountDetails: { totalAmount: '20.00', currency: 'USD' },
              },
            }),
          }
        ),
      { code: 'CYBERSOURCE_VERIFICATION_FAILED' }
    );

    await assert.rejects(
      () =>
        CyberSourcePaymentHelper.verifyTransaction(
          { transactionId: 'txn-789', expectedAmount: 20, expectedCurrency: 'USD' },
          {
            sdk: sdkWithTransaction({
              status: 'AUTHORIZED',
              orderInformation: {
                amountDetails: { totalAmount: '19.99', currency: 'USD' },
              },
            }),
          }
        ),
      { code: 'CYBERSOURCE_VERIFICATION_FAILED' }
    );

    assert.strictEqual(
      CyberSourcePaymentHelper.getConfig().runEnvironment,
      'apitest.cybersource.com'
    );

    process.env.CYBERSOURCE_TTP_ENV = 'sandbox';
    process.env.CYBERSOURCE_TTP_MERCHANT_ID = 'tap-to-pay-merchant';
    assert.strictEqual(
      CyberSourcePaymentHelper.getConfig().merchantID,
      'tap-to-pay-merchant'
    );
    assert.strictEqual(CyberSourcePaymentHelper.tapToPayEnabled(), true);
    console.log('CyberSource payment helper tests passed');
  } finally {
    restoreEnvironment();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
