const assert = require('assert');
const models = require('../../models');
const MarketplaceEventService = require('./marketplace-event-service');

const originals = {
  eventFind: models.MarketplaceEventModel.find,
  bidAggregate: models.MarketplaceBidModel.aggregate,
  bidFind: models.MarketplaceBidModel.find,
  foodApplicationAggregate: models.MarketplaceApplicationModel.aggregate,
  eventVendorApplicationAggregate: models.EventVendorApplicationModel.aggregate,
  questionAggregate: models.MarketplaceEventQuestionModel.aggregate,
};

const leanQuery = (result) => ({
  sort() { return this; },
  populate() { return this; },
  lean: async () => result,
});

const run = async () => {
  let bidAggregateCall = 0;
  let foodApplicationAggregateCall = 0;
  let foodApplicationPipeline;
  let eventVendorApplicationPipeline;

  models.MarketplaceEventModel.find = () => leanQuery([
    { event_id: 'event-1', customer_user_id: 'coordinator-1' },
  ]);
  models.MarketplaceBidModel.aggregate = async () => {
    bidAggregateCall += 1;
    return bidAggregateCall === 1 ? [{ _id: 'event-1', total: 3 }] : [];
  };
  models.MarketplaceBidModel.find = () => leanQuery([]);
  models.MarketplaceApplicationModel.aggregate = async (pipeline) => {
    foodApplicationAggregateCall += 1;
    if (foodApplicationAggregateCall === 1) {
      foodApplicationPipeline = pipeline;
      return [{ _id: 'event-1', total: 2 }];
    }
    return [];
  };
  models.EventVendorApplicationModel.aggregate = async (pipeline) => {
    eventVendorApplicationPipeline = pipeline;
    return [{ _id: 'event-1', total: 4 }];
  };
  models.MarketplaceEventQuestionModel.aggregate = async () => [];

  const [event] = await MarketplaceEventService.getMyEvents('coordinator-1');

  assert.equal(event.bid_count, 3);
  assert.equal(event.food_application_count, 2);
  assert.equal(event.event_vendor_application_count, 4);
  assert.equal(event.application_count, 6);
  assert.equal(event.submission_count, 9);
  assert.deepStrictEqual(
    foodApplicationPipeline[0].$match.application_status.$in,
    ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'PAYMENT_DUE', 'PAID', 'CONFIRMED', 'NOT_SELECTED']
  );
  assert.deepStrictEqual(
    eventVendorApplicationPipeline[0].$match.status,
    { $ne: 'WITHDRAWN' }
  );
};

run()
  .then(() => console.log('marketplace My Events application count service tests passed'))
  .finally(() => {
    models.MarketplaceEventModel.find = originals.eventFind;
    models.MarketplaceBidModel.aggregate = originals.bidAggregate;
    models.MarketplaceBidModel.find = originals.bidFind;
    models.MarketplaceApplicationModel.aggregate = originals.foodApplicationAggregate;
    models.EventVendorApplicationModel.aggregate = originals.eventVendorApplicationAggregate;
    models.MarketplaceEventQuestionModel.aggregate = originals.questionAggregate;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
