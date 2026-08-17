const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-ticket-controller.js');
const originalLoad = Module._load;

const event = {
  event_id: 'event-1',
  customer_user_id: 'coordinator-1',
  status: 'AWARDED',
  closed_at: null,
  ticket_sales_enabled: true,
  ticket_sales_closed_at: null,
};

Module._load = (request, parent, isMain) => {
  if (parent?.filename === controllerPath) {
    if (request === '../../models') {
      return {
        MarketplaceEventModel: {
          findOne: async (query) => {
            const blockedStatuses = query.status?.$nin || [];
            if (blockedStatuses.includes(event.status)) return null;
            return {
              ...event,
              save: async function save() {
                Object.assign(event, this);
                return this;
              },
            };
          },
          findOneAndUpdate: async (query, update) => {
            Object.assign(event, update.$set);
            return event;
          },
        },
      };
    }
    if (request === '../../helper/event-ticket-helper') return {};
    if (request === '../../helper/ticket-token-helper') {
      return {
        createTicketToken: () => ({ token: 'share-token', tokenHash: 'share-token-hash' }),
      };
    }
    if (request === '../../config') {
      return { server: { publicTicketBaseURL: 'https://tickets.example.com' } };
    }
    if (request === '../../helper/aws') return {};
    if (request === '../../helper/public-ticket-page') return {};
    if (request === '../../helper/ticket-qr-helper') return {};
    if (request.startsWith('../../helper/') || request.startsWith('../services/')) return {};
  }
  return originalLoad(request, parent, isMain);
};

delete require.cache[require.resolve(controllerPath)];
const controller = require(controllerPath);
Module._load = originalLoad;

(async () => {
  let response;
  let error;
  await controller.closeTicketSales(
    {
      params: { eventId: 'event-1' },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );

  assert.equal(error, undefined);
  assert.ok(response);
  assert.ok(event.ticket_sales_closed_at);
  assert.equal(event.status, 'AWARDED');
  assert.equal(event.closed_at, null);

  event.status = 'CLOSED';
  event.ticket_sales_closed_at = null;
  response = undefined;
  error = undefined;
  await controller.createTicketShareLink(
    {
      params: { eventId: 'event-1' },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  assert.equal(error, undefined);
  assert.equal(response.payload.share_url, 'https://tickets.example.com/events/share-token');
  assert.equal(event.status, 'CLOSED');
  assert.equal(event.ticket_sales_closed_at, null);

  console.log('marketplace ticket-sales close controller tests passed');
})().catch((caught) => {
  Module._load = originalLoad;
  console.error(caught);
  process.exitCode = 1;
});
