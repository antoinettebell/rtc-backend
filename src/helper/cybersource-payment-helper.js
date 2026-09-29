const CyberSource = require('cybersource-rest-client');

const APPROVED_STATUSES = new Set([
  'AUTHORIZED',
  'TRANSMITTED',
  'SETTLED',
  'SUCCEEDED',
  'COMPLETED',
]);
const SUCCESS_APPLICATION_STATUSES = new Set([
  'AUTHORIZED',
  'COMPLETED',
  'SUCCESS',
  'SUCCEEDED',
  'TRANSMITTED',
]);
const FAILED_TRANSACTION_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'DECLINED',
  'FAILED',
  'INVALID_REQUEST',
  'REJECTED',
  'REVERSED',
  'SERVER_ERROR',
  'VOIDED',
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
  logConfiguration: {
    enableLog: false,
    enableMasking: true,
  },
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

const searchTransactionsByReference = async (
  reference,
  { sdk = CyberSource } = {}
) => {
  const normalizedReference = String(reference || '').trim();
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(normalizedReference)) {
    const error = new Error('A valid CyberSource transaction reference is required.');
    error.code = 'CYBERSOURCE_REFERENCE_INVALID';
    throw error;
  }

  const config = getConfig();
  assertConfigured(config);
  const api = new sdk.SearchTransactionsApi(config);
  const request = {
    save: false,
    timezone: 'UTC',
    query: `clientReferenceInformation.code:${normalizedReference}`,
    offset: 0,
    limit: 10,
    sort: 'submitTimeUtc:desc',
  };

  return new Promise((resolve, reject) => {
    api.createSearch(request, (error, data) => {
      if (error) return reject(error);
      const embedded = data?._embedded || data?.embedded || {};
      const results = Array.isArray(embedded.transactionSummaries)
        ? embedded.transactionSummaries
        : [];
      return resolve(
        results
          .map(normalizeTransaction)
          .filter((transaction) => transaction.reference === normalizedReference)
      );
    });
  });
};

const objectKeys = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value).sort()
    : [];

const summarizeApplications = (applications, source) =>
  (Array.isArray(applications) ? applications : []).map((application) => ({
    source,
    keys: objectKeys(application),
    name: String(application?.name || application?.displayName || ''),
    status: String(application?.status || ''),
    reasonCode: String(application?.reasonCode || ''),
    replyCode: String(application?.rCode || application?.icsRcode || ''),
    replyFlag: String(application?.rFlag || application?.icsRflag || ''),
  }));

const buildTransactionResponseShape = (transaction = {}) => ({
  topLevelKeys: objectKeys(transaction),
  applicationInformationKeys: objectKeys(transaction.applicationInformation),
  amountDetailsKeys: objectKeys(transaction.orderInformation?.amountDetails),
  processorInformationKeys: objectKeys(transaction.processorInformation),
  directFieldPresence: {
    id: Boolean(transaction.id),
    requestId: Boolean(transaction.requestId),
    referenceNumber: Boolean(transaction.referenceNumber),
    authorizationCode: Boolean(transaction.authorizationCode),
    reasonCode: transaction.reasonCode !== undefined,
    icsRcode: transaction.icsRcode !== undefined,
    icsRflag: transaction.icsRflag !== undefined,
    amount: transaction.amount !== undefined,
    currency: transaction.currency !== undefined,
  },
  applications: [
    ...summarizeApplications(
      transaction.applicationInformation?.applications,
      'applicationInformation'
    ),
    ...summarizeApplications(transaction.applications, 'topLevel'),
  ],
});

const normalizeTransaction = (transaction = {}) => {
  const amountDetails = transaction.orderInformation?.amountDetails || {};
  const card = transaction.paymentInformation?.card || {};
  const applicationInformation = transaction.applicationInformation || {};
  const applications = Array.isArray(applicationInformation.applications)
    ? applicationInformation.applications
    : [];
  const authorizationApplication = applications.find((application) =>
    /auth/i.test(String(application?.name || ''))
  );
  const accountSuffix = String(card.suffix || '').replace(/\D/g, '').slice(-4);
  return {
    id: String(transaction.id || ''),
    status: String(transaction.status || applicationInformation.status || '').toUpperCase(),
    amount: Number(
      amountDetails.totalAmount ??
      amountDetails.authorizedAmount ??
      amountDetails.settlementAmount ??
      0
    ),
    currency: String(amountDetails.currency || amountDetails.settlementCurrency || '').toUpperCase(),
    reference: String(transaction.clientReferenceInformation?.code || ''),
    authCode: String(transaction.processorInformation?.approvalCode || '') || null,
    accountNumber: accountSuffix ? `XXXX${accountSuffix}` : null,
    accountType: String(card.brandName || card.type || '').toUpperCase() || null,
    reasonCode:
      String(
        authorizationApplication?.reasonCode ||
          applicationInformation.reasonCode ||
          ''
      ) || null,
    replyCode:
      String(
        authorizationApplication?.rCode || applicationInformation.rCode || ''
      ) || null,
    replyFlag:
      String(
        authorizationApplication?.rFlag || applicationInformation.rFlag || ''
      ).toUpperCase() || null,
    authorizationStatus:
      String(authorizationApplication?.status || '').toUpperCase() || null,
    submittedAt: transaction.submitTimeUTC || null,
  };
};

const hasSuccessfulAuthorization = (transaction) => {
  if (APPROVED_STATUSES.has(transaction.status)) return true;
  if (
    FAILED_TRANSACTION_STATUSES.has(transaction.status) ||
    transaction.reasonCode !== '100'
  ) {
    return false;
  }

  return Boolean(
    transaction.authCode &&
      (transaction.replyCode === '1' ||
        transaction.replyFlag === 'SOK' ||
        SUCCESS_APPLICATION_STATUSES.has(transaction.authorizationStatus))
  );
};

const verifyTransaction = async ({ transactionId, expectedAmount, expectedCurrency = 'USD', expectedReference = null }, options = {}) => {
  assertTapToPayEnabled();
  if (!transactionId) throw new Error('CyberSource transaction ID is required.');
  let providerResponse;
  try {
    providerResponse = await retrieveTransaction(transactionId, options);
  } catch (retrievalError) {
    console.error('CyberSource Tap to Pay transaction retrieval failed', {
      name: retrievalError?.name || null,
      code: retrievalError?.code || null,
      status: retrievalError?.status || retrievalError?.statusCode || null,
      errorKeys: objectKeys(retrievalError),
      responseKeys: objectKeys(retrievalError?.response),
    });
    throw retrievalError;
  }

  const transaction = normalizeTransaction(providerResponse);
  const idMatches = transaction.id === String(transactionId);
  const authorizationConfirmed = hasSuccessfulAuthorization(transaction);
  const amountMatches = Math.round(transaction.amount * 100) === Math.round(Number(expectedAmount) * 100);
  const currencyMatches = transaction.currency === String(expectedCurrency).toUpperCase();
  const referenceMatches = !expectedReference || transaction.reference === String(expectedReference);
  if (
    !idMatches ||
    !authorizationConfirmed ||
    !amountMatches ||
    !currencyMatches ||
    !referenceMatches
  ) {
    console.error('CyberSource Tap to Pay transaction verification mismatch', {
      responseShape: buildTransactionResponseShape(providerResponse),
      normalized: {
        idPresent: Boolean(transaction.id),
        status: transaction.status,
        reasonCode: transaction.reasonCode,
        replyCode: transaction.replyCode,
        replyFlag: transaction.replyFlag,
        authorizationStatus: transaction.authorizationStatus,
        authCodePresent: Boolean(transaction.authCode),
        amount: transaction.amount,
        currency: transaction.currency,
        referencePresent: Boolean(transaction.reference),
      },
      expected: {
        amount: Number(expectedAmount),
        currency: String(expectedCurrency).toUpperCase(),
        referenceRequired: Boolean(expectedReference),
      },
      checks: {
        idMatches,
        authorizationConfirmed,
        amountMatches,
        currencyMatches,
        referenceMatches,
      },
    });
    const error = new Error('CyberSource transaction verification failed.');
    error.code = 'CYBERSOURCE_VERIFICATION_FAILED';
    throw error;
  }
  return transaction;
};

module.exports = {
  APPROVED_STATUSES,
  buildTransactionResponseShape,
  getConfig,
  hasSuccessfulAuthorization,
  normalizeTransaction,
  retrieveTransaction,
  searchTransactionsByReference,
  tapToPayEnabled,
  verifyTransaction,
};
