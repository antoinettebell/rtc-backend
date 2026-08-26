const CyberSource = require('cybersource-rest-client');

const APPROVED_STATUSES = new Set([
  'AUTHORIZED',
  'TRANSMITTED',
  'SETTLED',
  'SUCCEEDED',
  'COMPLETED',
]);

const firstConfiguredValue = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '');

const tapToPayEnabled = () =>
  String(process.env.CYBERSOURCE_TTP_ENABLED || '').trim().toLowerCase() === 'true';

const isSandboxEnvironment = () =>
  /^(sandbox|test|testing|development|dev)$/i.test(
    String(
      firstConfiguredValue(
        process.env.CYBERSOURCE_TTP_ENV,
        process.env.CYBERSOURCE_ENVIRONMENT
      ) || ''
    )
  );

const getConfig = () => ({
  authenticationType: 'jwt',
  jwtKeyType: 'SHARED_SECRET',
  merchantID: firstConfiguredValue(
    process.env.CYBERSOURCE_TTP_MERCHANT_ID,
    process.env.CYBERSOURCE_MERCHANT_ID
  ),
  merchantKeyId: process.env.CYBERSOURCE_REST_KEY_ID,
  merchantsecretKey: process.env.CYBERSOURCE_REST_SHARED_SECRET,
  runEnvironment:
    isSandboxEnvironment()
      ? 'apitest.cybersource.com'
      : 'api.cybersource.com',
  enableLog: false,
});

const assertConfigured = (config) => {
  const missing = [
    ['CYBERSOURCE_TTP_MERCHANT_ID or CYBERSOURCE_MERCHANT_ID', config.merchantID],
    ['CYBERSOURCE_REST_KEY_ID', config.merchantKeyId],
    ['CYBERSOURCE_REST_SHARED_SECRET', config.merchantsecretKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const error = new Error(`CyberSource verification is not configured: ${missing.join(', ')}`);
    error.code = 'CYBERSOURCE_NOT_CONFIGURED';
    throw error;
  }
};

const assertTapToPayEnabled = () => {
  if (!tapToPayEnabled()) {
    const error = new Error('CyberSource Tap to Pay is not enabled.');
    error.code = 'CYBERSOURCE_TTP_DISABLED';
    throw error;
  }
};

const retrieveTransaction = async (transactionId, { sdk = CyberSource } = {}) => {
  const config = getConfig();
  assertConfigured(config);
  const api = new sdk.TransactionDetailsApi(config);
  return new Promise((resolve, reject) => {
    api.getTransaction(String(transactionId), (error, data) => {
      if (error) return reject(error);
      return resolve(data);
    });
  });
};

const normalizeTransaction = (transaction = {}) => {
  const amountDetails = transaction.orderInformation?.amountDetails || {};
  return {
    id: String(transaction.id || ''),
    status: String(transaction.status || transaction.applicationInformation?.status || '').toUpperCase(),
    amount: Number(
      amountDetails.totalAmount ??
      amountDetails.authorizedAmount ??
      amountDetails.settlementAmount ??
      0
    ),
    currency: String(amountDetails.currency || amountDetails.settlementCurrency || '').toUpperCase(),
    reference: String(transaction.clientReferenceInformation?.code || ''),
  };
};

const verifyTransaction = async ({ transactionId, expectedAmount, expectedCurrency = 'USD', expectedReference = null }, options = {}) => {
  assertTapToPayEnabled();
  if (!transactionId) throw new Error('CyberSource transaction ID is required.');
  const transaction = normalizeTransaction(await retrieveTransaction(transactionId, options));
  const amountMatches = Math.round(transaction.amount * 100) === Math.round(Number(expectedAmount) * 100);
  const currencyMatches = transaction.currency === String(expectedCurrency).toUpperCase();
  const referenceMatches = !expectedReference || transaction.reference === String(expectedReference);
  if (
    transaction.id !== String(transactionId) ||
    !APPROVED_STATUSES.has(transaction.status) ||
    !amountMatches ||
    !currencyMatches ||
    !referenceMatches
  ) {
    const error = new Error('CyberSource transaction verification failed.');
    error.code = 'CYBERSOURCE_VERIFICATION_FAILED';
    throw error;
  }
  return transaction;
};

module.exports = {
  APPROVED_STATUSES,
  getConfig,
  normalizeTransaction,
  retrieveTransaction,
  tapToPayEnabled,
  verifyTransaction,
};
