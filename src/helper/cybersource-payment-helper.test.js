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

const sdkWithSearchResults = (transactions, capture) => ({
  SearchTransactionsApi: class SearchTransactionsApi {
    createSearch(request, callback) {
      capture.request = request;
      callback(null, {
        _embedded: { transactionSummaries: transactions },
      });
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

    const capture = {};
    const searchResults = await CyberSourcePaymentHelper.searchTransactionsByReference(
      'R1234567',
      {
        sdk: sdkWithSearchResults(
          [
            {
              id: 'txn-search-1',
              status: 'AUTHORIZED',
              clientReferenceInformation: { code: 'R1234567' },
              orderInformation: {
                amountDetails: { totalAmount: '25.00', currency: 'USD' },
              },
            },
            {
              id: 'txn-other',
              status: 'AUTHORIZED',
              clientReferenceInformation: { code: 'OTHER' },
            },
          ],
          capture
        ),
      }
    );
    assert.strictEqual(
      capture.request.query,
      'clientReferenceInformation.code:R1234567'
    );
    assert.strictEqual(searchResults.length, 1);
    assert.strictEqual(searchResults[0].id, 'txn-search-1');

    await assert.rejects(
      () =>
        CyberSourcePaymentHelper.searchTransactionsByReference('bad reference', {
          sdk: sdkWithSearchResults([], {}),
        }),
      { code: 'CYBERSOURCE_REFERENCE_INVALID' }
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
