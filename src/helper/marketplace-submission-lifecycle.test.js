const assert = require('assert');
const fs = require('fs');
const path = require('path');
const lifecycle = require('./marketplace-submission-lifecycle');

assert(lifecycle.ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES.includes('SUBMITTED'));
assert(lifecycle.ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES.includes('AWARDED'));
assert(!lifecycle.ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES.includes('WITHDRAWN'));
assert(lifecycle.isEventVendorApplicationEditable('submitted'));
assert(lifecycle.isEventVendorApplicationWithdrawable('UNDER_REVIEW'));
assert(!lifecycle.isEventVendorApplicationEditable('AWARDED'));
assert(!lifecycle.isEventVendorApplicationWithdrawable('WITHDRAWN'));
for (const status of ['OPEN', 'REOPENED']) {
  assert(lifecycle.isEventOpenForOrdinaryWithdrawal({ status }));
}
for (const status of ['CLOSED', 'CANCELLED']) {
  assert(!lifecycle.isEventOpenForOrdinaryWithdrawal({ status }));
}
assert(!lifecycle.isEventOpenForOrdinaryWithdrawal({ status: 'OPEN', vendor_applications_closed_at: new Date() }));
assert(!lifecycle.isEventOpenForOrdinaryWithdrawal({ status: 'OPEN', event_close_date: new Date('2020-01-01') }));
const activePhoto = { photo_id: 'active' };
const priorArchivedSnapshot = { photo_id: 'prior', status: 'ARCHIVED' };
assert.deepStrictEqual(lifecycle.resolveSelectedApplicationPhotos({
  photoIds: ['active', 'prior'],
  activePhotos: [activePhoto],
  priorSnapshots: [priorArchivedSnapshot],
}), [activePhoto, priorArchivedSnapshot]);
assert.deepStrictEqual(lifecycle.resolveSelectedApplicationPhotos({
  photoIds: ['arbitrary-archived'],
  activePhotos: [],
  priorSnapshots: [priorArchivedSnapshot],
}), []);
assert.deepStrictEqual(lifecycle.buildEventVendorRequirementSummary({
  needs: [
    { vendor_type: 'MERCHANDISE', quantity: 3 },
    { vendor_type: 'MERCHANDISE', quantity: 2 },
    { vendor_type: 'SERVICE', quantity: 2 },
    { vendor_type: 'OTHER', quantity: 1 },
  ],
  applications: [
    { application_id: 'combined', status: 'AWARDED', vendor_types: ['MERCHANDISE', 'SERVICE'] },
    { application_id: 'merch', status: 'PAYMENT_DUE', vendor_types: ['MERCHANDISE'] },
    { application_id: 'merch', status: 'PAYMENT_DUE', vendor_types: ['MERCHANDISE'] },
    { status: 'SUBMITTED', vendor_types: ['OTHER'] },
  ],
}), [
  { vendor_type: 'MERCHANDISE', requested: 5, filled: 2, remaining: 3 },
  { vendor_type: 'SERVICE', requested: 2, filled: 1, remaining: 1 },
  { vendor_type: 'OTHER', requested: 1, filled: 0, remaining: 1 },
]);
assert.deepStrictEqual(lifecycle.getCoordinatorNotSelectTransition('BID', 'SUBMITTED'), {
  idempotent: false,
  targetStatus: 'DECLINED',
  eligible: true,
});
assert.deepStrictEqual(lifecycle.getCoordinatorNotSelectTransition('APPLICATION', 'NOT_SELECTED'), {
  idempotent: true,
  targetStatus: 'NOT_SELECTED',
});
assert.strictEqual(lifecycle.getCoordinatorNotSelectTransition('APPLICATION', 'AWARDED').eligible, false);
const marketplaceSource = fs.readFileSync(path.join(__dirname, '../v1/controllers/marketplace-controller.js'), 'utf8');
const eventVendorSource = fs.readFileSync(path.join(__dirname, '../v1/controllers/event-vendor-controller.js'), 'utf8');
assert.match(marketplaceSource, /event_id: \{ \$nin: excludedEventIds \}/);
assert.match(marketplaceSource, /Marketplace application already withdrawn/);
assert.match(marketplaceSource, /Marketplace bid already withdrawn/);
assert.match(eventVendorSource, /ACTIVE_EVENT_VENDOR_APPLICATION_STATUSES/);
assert.match(eventVendorSource, /Marketplace Vendor application already withdrawn/);
assert.match(eventVendorSource, /Object\.assign\(existingApplication, applicationPayload\)/);
assert.match(eventVendorSource, /isEventOpenForOrdinaryWithdrawal\(event\)/);
assert.match(eventVendorSource, /status: 'ACTIVE',[\s\S]*source: 'REPOSITORY'/);
assert.match(eventVendorSource, /resolveSelectedApplicationPhotos/);
assert.match(marketplaceSource, /assertMarketplaceTextAllowed\(questionText, 'Message'\)[\s\S]*MarketplaceEventQuestionService\.create/);
assert.match(marketplaceSource, /vendor_user_id: req\.user\._id[\s\S]*application_id: req\.body\.application_id/);
assert.match(eventVendorSource, /Marketplace Vendor application not selected/);
console.log('marketplace submission lifecycle tests passed');
