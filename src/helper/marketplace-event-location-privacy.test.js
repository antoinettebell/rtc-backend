const assert = require('assert');
const { applyMarketplaceEventLocationPrivacy } = require('./marketplace-event-location-privacy');

const event = {
  event_address: '100 Main St',
  formatted_address: '100 Main St, Columbia, SC 29201',
  event_city: 'Columbia',
  event_state: 'SC',
  event_zip: '29201',
};

const unselected = applyMarketplaceEventLocationPrivacy(event, { locationUnlocked: false });
assert.equal(unselected.exact_address_locked, true);
assert.equal(unselected.event_address, undefined);
assert.equal(unselected.formatted_address, undefined);
assert.equal(unselected.event_city, 'Columbia');
assert.equal(unselected.event_state, 'SC');

const selected = applyMarketplaceEventLocationPrivacy(event, { locationUnlocked: true });
assert.equal(selected.exact_address_locked, false);
assert.equal(selected.event_address, '100 Main St');
assert.equal(selected.formatted_address, '100 Main St, Columbia, SC 29201');
assert.equal(selected.event_zip, '29201');

console.log('marketplace event location privacy tests passed');
