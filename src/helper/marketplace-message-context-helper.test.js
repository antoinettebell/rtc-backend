const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildMarketplaceMessageScope,
  assertMarketplaceMessageParticipantContext,
  resolveMarketplaceSubmissionParticipant,
} = require('./marketplace-message-context-helper');

assert.deepStrictEqual(buildMarketplaceMessageScope({ bidId: 'bid-1' }), { bid_id: 'bid-1' });
assert.deepStrictEqual(buildMarketplaceMessageScope({ applicationId: 'app-1' }), { application_id: 'app-1' });
assert(assertMarketplaceMessageParticipantContext({ foodTruckId: 'truck-1', bidId: 'bid-1' }));
assert(assertMarketplaceMessageParticipantContext({ eventVendorProfileId: 'profile-1', applicationId: 'app-1' }));
assert.throws(() => assertMarketplaceMessageParticipantContext({ applicationId: 'app-1' }), /participant/);
assert.throws(() => assertMarketplaceMessageParticipantContext({ foodTruckId: 'truck-1', eventVendorProfileId: 'profile-1' }), /participant/);
assert.throws(() => buildMarketplaceMessageScope({ bidId: 'bid-1', applicationId: 'app-1' }), /either/);
assert.deepStrictEqual(
  resolveMarketplaceSubmissionParticipant({
    foodBid: { food_truck_id: 'food-truck-1' },
    fallbackEventVendorProfileId: 'profile-1',
  }),
  { foodTruckId: 'food-truck-1', eventVendorProfileId: null, displayIdentity: 'food-truck-1' }
);
assert.deepStrictEqual(
  resolveMarketplaceSubmissionParticipant({
    foodApplication: { food_truck_id: 'food-truck-2' },
    fallbackEventVendorProfileId: 'profile-1',
  }),
  { foodTruckId: 'food-truck-2', eventVendorProfileId: null, displayIdentity: 'food-truck-2' }
);
assert.deepStrictEqual(
  resolveMarketplaceSubmissionParticipant({
    eventVendorApplication: { profile_id: 'profile-2' },
    fallbackFoodTruckId: 'food-truck-1',
  }),
  { foodTruckId: null, eventVendorProfileId: 'profile-2', displayIdentity: 'profile-2' }
);
assert.throws(
  () => resolveMarketplaceSubmissionParticipant({ foodApplication: { food_truck_id: 'truck' }, eventVendorApplication: { profile_id: 'profile' } }),
  /ambiguous/
);
let lookupCount = 0;
let createCount = 0;
let notifyCount = 0;
const simulateControllerScopeGate = ({ bidId, applicationId }) => {
  buildMarketplaceMessageScope({ bidId, applicationId });
  lookupCount += 1;
  createCount += 1;
  notifyCount += 1;
};
assert.throws(() => simulateControllerScopeGate({ bidId: 'bid-1', applicationId: 'app-1' }), /either/);
assert.deepStrictEqual({ lookupCount, createCount, notifyCount }, { lookupCount: 0, createCount: 0, notifyCount: 0 });
const modelSource = fs.readFileSync(path.join(__dirname, '../models/marketplace-event-question.js'), 'utf8');
const controllerSource = fs.readFileSync(path.join(__dirname, '../v1/controllers/marketplace-controller.js'), 'utf8');
const askControllerSource = controllerSource.slice(controllerSource.indexOf('exports.askEventQuestion'));
assert.match(modelSource, /Marketplace message requires one valid vendor participant context/);
assert.match(controllerSource, /assertMarketplaceMessageParticipantContext/);
assert(
  askControllerSource.indexOf('buildMarketplaceMessageScope({ bidId: req.body.bid_id, applicationId: req.body.application_id })')
    < askControllerSource.indexOf('const event = await getEventForUser(req.params.eventId, req.user)'),
  'ambiguous submission identifiers are rejected before controller lookups'
);
assert.match(controllerSource, /vendor_user_id: req\.user\._id,[\s\S]*status: \{ \$in: \['PENDING', 'PUBLISHED'\] \}/);

console.log('marketplace message context tests passed');
