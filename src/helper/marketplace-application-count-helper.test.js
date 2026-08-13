const assert = require('assert');
const {
  getMarketplaceApplicationCounts,
} = require('./marketplace-application-count-helper');

assert.deepStrictEqual(
  getMarketplaceApplicationCounts({
    eventId: 'event-1',
    foodApplicationCounts: [{ _id: 'event-1', total: 2 }],
    eventVendorApplicationCounts: [{ _id: 'event-1', total: 3 }],
  }),
  {
    food_application_count: 2,
    event_vendor_application_count: 3,
    application_count: 5,
  }
);

assert.deepStrictEqual(
  getMarketplaceApplicationCounts({ eventId: 'event-with-no-applications' }),
  {
    food_application_count: 0,
    event_vendor_application_count: 0,
    application_count: 0,
  }
);

console.log('marketplace application count helper tests passed');
