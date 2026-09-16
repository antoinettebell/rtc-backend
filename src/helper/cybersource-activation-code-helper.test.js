const assert = require('assert');

const originalEnvironment = {
  CYBERSOURCE_TTP_ENABLED: process.env.CYBERSOURCE_TTP_ENABLED,
  CYBERSOURCE_TTP_ENV: process.env.CYBERSOURCE_TTP_ENV,
  CYBERSOURCE_TTP_MERCHANT_ID: process.env.CYBERSOURCE_TTP_MERCHANT_ID,
  CYBERSOURCE_REST_KEY_ID: process.env.CYBERSOURCE_REST_KEY_ID,
  CYBERSOURCE_REST_SHARED_SECRET: process.env.CYBERSOURCE_REST_SHARED_SECRET,
};

process.env.CYBERSOURCE_TTP_ENABLED = 'true';
process.env.CYBERSOURCE_TTP_ENV = 'production';
process.env.CYBERSOURCE_TTP_MERCHANT_ID = 'production-mid';
process.env.CYBERSOURCE_REST_KEY_ID = 'rest-key-id';
process.env.CYBERSOURCE_REST_SHARED_SECRET = 'rest-shared-secret';

const Helper = require('./cybersource-activation-code-helper');

const restoreEnvironment = () => {
  Object.entries(originalEnvironment).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
};

const run = async () => {
  try {
    let configured;
    const apiClient = {
      setConfiguration(config) {
        configured = config;
      },
      callApi(...args) {
        const [
          path,
          method,
          pathParams,
          queryParams,
          headerParams,
          formParams,
          body,
          authNames,
          contentTypes,
          accepts,
          returnType,
          isResponseMLE,
          callback,
        ] = args;
        assert.strictEqual(path, '/dms/v2/merchants/{merchantId}/activation-codes');
        assert.strictEqual(method, 'POST');
        assert.deepStrictEqual(pathParams, { merchantId: 'production-mid' });
        assert.deepStrictEqual(queryParams, { size: 1 });
        assert.deepStrictEqual(headerParams, {});
        assert.deepStrictEqual(formParams, {});
        assert.deepStrictEqual(body, {});
        assert.deepStrictEqual(authNames, []);
        assert.deepStrictEqual(contentTypes, ['application/json']);
        assert.deepStrictEqual(accepts, ['application/json']);
        assert.strictEqual(returnType, Object);
        assert.strictEqual(isResponseMLE, false);
        callback(null, { tokens: [{ token: 'one-time-code', ttl: 86399805 }] });
      },
    };

    const result = await Helper.createActivationCode({ apiClient });
    assert.strictEqual(configured.runEnvironment, 'api.cybersource.com');
    assert.strictEqual(result.token, 'one-time-code');
    assert.strictEqual(result.ttl, 86399805);

    apiClient.callApi = (...args) => args.at(-1)(null, { tokens: [] });
    await assert.rejects(
      () => Helper.createActivationCode({ apiClient }),
      { code: 'CYBERSOURCE_ACTIVATION_CODE_MISSING' }
    );

    console.log('CyberSource activation code helper tests passed.');
  } finally {
    restoreEnvironment();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
