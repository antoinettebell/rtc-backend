const assert = require('assert');
const { resolveEventVendorParticipationPath } = require('./event-vendor-participation-helper');

assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'COORDINATOR' }), 'BID');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'VENDOR' }), 'APPLICATION');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', requestedPath: 'BID' }), 'BID');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', requestedPath: 'APPLICATION' }), 'APPLICATION');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: { category_fee: 25 } }), 'APPLICATION');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: { category_fee: 0 } }), 'APPLICATION');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: { category_fee: 0, electricity_fee: 15, checkout_subtotal: 15 } }), 'APPLICATION');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: { participation_path: 'BID', category_fee: 0 } }), 'BID');
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: { participation_path: 'APPLICATION', category_fee: 0 } }), 'APPLICATION');
const legacy = { category_fee: 0, electricity_fee: 12, checkout_subtotal: 12 };
const legacyBefore = JSON.parse(JSON.stringify(legacy));
assert.equal(resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH', existingApplication: legacy }), 'APPLICATION');
assert.deepStrictEqual(legacy, legacyBefore, 'classification does not mutate or recalculate legacy fees');
assert.throws(() => resolveEventVendorParticipationPath({ paymentResponsibility: 'BOTH' }), /Choose My Bid/);
console.log('event vendor participation classification tests passed');
