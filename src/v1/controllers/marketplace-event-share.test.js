const assert = require('assert');

const TicketController = require('./marketplace-ticket-controller');
const { MarketplaceEventModel, MarketplaceEventImageModel } = require('../../models');

const event = {
  _id: 'mongo-event-1',
  event_id: 'event-1',
  customer_user_id: 'coordinator-1',
  event_name: 'Community Night',
  event_description: 'Food and music downtown.',
  event_visibility: 'PRIVATE',
  status: 'OPEN',
  event_date: new Date('2099-08-08T00:00:00.000Z'),
  event_time: '18:00',
  event_duration_hours: 4,
  event_duration_minutes: 0,
  event_timezone: 'America/New_York',
  event_city: 'Charlotte',
  event_state: 'NC',
  ticket_sales_enabled: false,
  ticket_sales_closed_at: null,
};
const image = {
  event_id: 'event-1',
  image_url: 'https://assets.example/community-night.jpg',
  status: 'ACTIVE',
};

const originalEventFindOne = MarketplaceEventModel.findOne;
const originalEventUpdateOne = MarketplaceEventModel.updateOne;
const originalImageFindOne = MarketplaceEventImageModel.findOne;
let eventQuery;
let imageQuery;
let eventUpdate;

MarketplaceEventModel.findOne = (query) => {
  eventQuery = query;
  return { lean: async () => event };
};
MarketplaceEventImageModel.findOne = (query) => {
  imageQuery = query;
  return { lean: async () => image };
};
MarketplaceEventModel.updateOne = async (query, update) => {
  eventUpdate = { query, update };
  return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
};

const callCreate = () => new Promise((resolve) => {
  const req = {
    params: { eventId: 'event-1' },
    user: { _id: 'coordinator-1' },
    body: { image_url: image.image_url },
  };
  const res = { data: (data, message) => resolve({ data, message }) };
  TicketController.createEventShareLink(req, res, (error) => resolve({ error }));
});

(async () => {
  try {
    const result = await callCreate();
    assert.ifError(result.error);
    assert.match(result.data.share_url, /^https:\/\/.*\/event-share\//);
    assert.equal(result.data.image_url, image.image_url);
    assert.equal(result.data.event_visibility, 'PRIVATE');
    assert.equal(result.data.ticket_sales_enabled, false);
    assert.equal(eventQuery.customer_user_id, 'coordinator-1');
    assert.equal(imageQuery.event_id, 'event-1');
    assert.equal(imageQuery.status, 'ACTIVE');
    assert.equal(eventUpdate.query.customer_user_id, 'coordinator-1');
    assert.equal(eventUpdate.update.$set?.event_visibility, undefined, 'sharing must not change visibility');
    assert.equal(eventUpdate.update.$push.event_share_links.image_url, image.image_url);
    console.log('Marketplace event sharing controller tests passed.');
  } finally {
    MarketplaceEventModel.findOne = originalEventFindOne;
    MarketplaceEventModel.updateOne = originalEventUpdateOne;
    MarketplaceEventImageModel.findOne = originalImageFindOne;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
