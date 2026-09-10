import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveFirebaseProjectForUserType,
  isStaleTokenError,
} = require('./fcm');

assert.equal(resolveFirebaseProjectForUserType('CUSTOMER'), 'CUSTOMER');
assert.equal(resolveFirebaseProjectForUserType('VENDOR'), 'VENDOR');
assert.equal(resolveFirebaseProjectForUserType('EMPLOYEE'), 'VENDOR');
assert.equal(resolveFirebaseProjectForUserType('SUPER_ADMIN'), null);
assert.equal(
  isStaleTokenError({ code: 'messaging/registration-token-not-registered' }),
  true
);
assert.equal(
  isStaleTokenError({ code: 'messaging/mismatched-credential' }),
  false
);

console.log('fcm routing checks passed');
