const CyberSource = require('cybersource-rest-client');
const CyberSourcePaymentHelper = require('./cybersource-payment-helper');

const buildError = (message, code, status = 502) => {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
};

const createActivationCode = async ({ sdk = CyberSource, apiClient } = {}) => {
  if (!CyberSourcePaymentHelper.tapToPayEnabled()) {
    throw buildError(
      'CyberSource Tap to Pay is not enabled.',
      'CYBERSOURCE_TTP_DISABLED',
      503
    );
  }

  const config = CyberSourcePaymentHelper.getConfig();
  const missing = [
    ['CYBERSOURCE_TTP_MERCHANT_ID or CYBERSOURCE_MERCHANT_ID', config.merchantID],
    ['CYBERSOURCE_REST_KEY_ID', config.merchantKeyId],
    ['CYBERSOURCE_REST_SHARED_SECRET', config.merchantsecretKey],
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    throw buildError(
      `CyberSource activation code generation is not configured: ${missing.join(', ')}`,
      'CYBERSOURCE_ACTIVATION_NOT_CONFIGURED',
      503
    );
  }

  const client = apiClient || new sdk.ApiClient();
  client.setConfiguration(config);

  const response = await new Promise((resolve, reject) => {
    client.callApi(
      '/dms/v2/merchants/{merchantId}/activation-codes',
      'POST',
      { merchantId: config.merchantID },
      { size: 1 },
      {},
      {},
      {},
      [],
      ['application/json'],
      ['application/json'],
      Object,
      false,
      (error, data) => {
        if (error) return reject(error);
        return resolve(data);
      }
    );
  });

  const token = String(response?.tokens?.[0]?.token || '').trim();
  const ttl = Number(response?.tokens?.[0]?.ttl);
  if (!token) {
    throw buildError(
      'CyberSource did not return a Tap to Pay activation code.',
      'CYBERSOURCE_ACTIVATION_CODE_MISSING'
    );
  }

  return {
    token,
    ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : null,
  };
};

module.exports = {
  createActivationCode,
};
