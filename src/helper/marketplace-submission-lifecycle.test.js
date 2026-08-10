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
console.log('marketplace submission lifecycle tests passed');
