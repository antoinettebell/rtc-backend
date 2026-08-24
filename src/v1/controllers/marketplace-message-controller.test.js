const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveMarketplaceSubmissionParticipant,
} = require('../../helper/marketplace-message-context-helper');

let persistenceCount = 0;
let notificationCount = 0;
const simulateCoordinatorApplicationMessage = ({ foodApplication, eventVendorApplication }) => {
  const participant = resolveMarketplaceSubmissionParticipant({
    foodApplication,
    eventVendorApplication,
  });
  persistenceCount += 1;
  notificationCount += 1;
  return participant;
};

assert.deepStrictEqual(
  simulateCoordinatorApplicationMessage({ foodApplication: { food_truck_id: 'truck-1' } }),
  { foodTruckId: 'truck-1', eventVendorProfileId: null, displayIdentity: 'truck-1' }
);
assert.deepStrictEqual(
  simulateCoordinatorApplicationMessage({ eventVendorApplication: { profile_id: 'profile-1' } }),
  { foodTruckId: null, eventVendorProfileId: 'profile-1', displayIdentity: 'profile-1' }
);
const beforeAmbiguous = { persistenceCount, notificationCount };
assert.throws(
  () => simulateCoordinatorApplicationMessage({
    foodApplication: { food_truck_id: 'truck-duplicate' },
    eventVendorApplication: { profile_id: 'profile-duplicate' },
  }),
  /ambiguous/
);
assert.deepStrictEqual(
  { persistenceCount, notificationCount },
  beforeAmbiguous,
  'ambiguous coordinator messages do not persist or notify'
);

const source = fs.readFileSync(path.join(__dirname, 'marketplace-controller.js'), 'utf8');
const askSource = source.slice(source.indexOf('exports.askEventQuestion'));
assert.match(askSource, /const \[targetFoodApplication, targetEventVendorApplication\]/);
assert.match(askSource, /resolveMarketplaceSubmissionParticipant\(\{[\s\S]*foodApplication: targetFoodApplication,[\s\S]*eventVendorApplication: targetEventVendorApplication/);
assert.doesNotMatch(askSource, /\)\) \|\| \(await EventVendorApplicationModel\.findOne/);

const getQuestionsSource = source.slice(
  source.indexOf('exports.getEventQuestions'),
  source.indexOf('exports.askEventQuestion')
);
assert(
  getQuestionsSource.indexOf('MarketplaceEventQuestionService.getByData') <
    getQuestionsSource.indexOf('markMarketplaceQuestionsRead'),
  'the response captures unread state before the read acknowledgement is persisted'
);
const notificationSource = source.slice(source.indexOf('exports.vendorNotificationSummary'));
assert.match(notificationSource, /\.\.\.questions\.map\(\(question\) => question\.event_id\)/);
assert.match(notificationSource, /buildMarketplaceMessageNotification\(question, event, req\.user\)/);
assert.match(notificationSource, /messageNotifications\.filter\(\(item\) => item\.unread\)\.length/);
assert.match(
  notificationSource,
  /const specialtyUpdateNotifications = closedCandidateBids[\s\S]*?specialty_update_available_at/,
  'submitted Food Vendor bids marked for specialty updates appear in the vendor bell feed'
);

console.log('marketplace coordinator message controller tests passed');
