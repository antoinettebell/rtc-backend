const assert = require('assert');
const SmsHelper = require('./sms-helper');

assert.strictEqual(SmsHelper.normalizePhoneNumber('(212) 555-0198'), '+12125550198');
assert.strictEqual(SmsHelper.normalizePhoneNumber('1-212-555-0198'), '+12125550198');
assert.strictEqual(SmsHelper.normalizePhoneNumber('+44 20 7946 0958'), '+442079460958');
assert.strictEqual(SmsHelper.normalizePhoneNumber('555-0198'), null);
assert.strictEqual(SmsHelper.maskPhoneNumber('+1 212 555 0198'), '***0198');

assert.deepStrictEqual(SmsHelper.parseTwilioResponse(''), {});
assert.deepStrictEqual(SmsHelper.parseTwilioResponse('{"sid":"SM123","status":"queued"}'), {
  sid: 'SM123',
  status: 'queued',
});
assert.deepStrictEqual(SmsHelper.parseTwilioResponse('service unavailable'), {
  rawBody: 'service unavailable',
});

console.log('sms-helper tests passed');
