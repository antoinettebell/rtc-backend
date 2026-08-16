const assert = require('node:assert/strict');
const {
  CUSTOMER_IOS_APP_ID,
  CUSTOMER_ANDROID_PACKAGE,
  CUSTOMER_ANDROID_CERTIFICATES,
  sendAppleAppSiteAssociation,
  sendAndroidAssetLinks,
} = require('./mobile-app-association');

const execute = handler => {
  const response = {
    headers: {},
    contentType: null,
    body: null,
    set(headers) {
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    type(contentType) {
      this.contentType = contentType;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
  handler({}, response);
  return response;
};

const apple = execute(sendAppleAppSiteAssociation);
assert.equal(apple.contentType, 'application/json');
assert.equal(apple.headers['X-Content-Type-Options'], 'nosniff');
assert.deepEqual(apple.body.applinks.details, [
  { appID: CUSTOMER_IOS_APP_ID, paths: ['/events/*'] },
]);

const android = execute(sendAndroidAssetLinks);
assert.equal(android.contentType, 'application/json');
assert.equal(android.body[0].target.package_name, CUSTOMER_ANDROID_PACKAGE);
assert.deepEqual(
  android.body[0].target.sha256_cert_fingerprints,
  CUSTOMER_ANDROID_CERTIFICATES
);
assert.equal(CUSTOMER_ANDROID_CERTIFICATES.length, 2);

console.log('mobile app association checks passed');
