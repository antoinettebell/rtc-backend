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
  {
    appID: CUSTOMER_IOS_APP_ID,
    paths: ['/events/*', '/event-share/*'],
  },
  {
    appID: '5G26GFF98P.com.rounddacorner.dev.customer',
    paths: ['/events/*', '/event-share/*'],
  },
]);

const android = execute(sendAndroidAssetLinks);
assert.equal(android.contentType, 'application/json');
assert.equal(android.body[0].target.package_name, CUSTOMER_ANDROID_PACKAGE);
assert.deepEqual(
  android.body[0].target.sha256_cert_fingerprints,
  CUSTOMER_ANDROID_CERTIFICATES
);
assert.deepEqual(CUSTOMER_ANDROID_CERTIFICATES, [
  '25:04:1E:97:01:02:5F:C2:62:CF:9D:33:DE:D0:55:60:2D:58:E6:8A:41:52:10:D7:B5:CE:59:8A:C3:0A:D4:0F',
]);
assert.equal(android.body.length, 2);
assert.equal(
  android.body[1].target.package_name,
  'com.rounddacorner.dev.customer'
);

console.log('mobile app association checks passed');
