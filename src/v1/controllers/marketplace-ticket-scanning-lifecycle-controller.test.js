const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-ticket-controller.js');
const originalLoad = Module._load;

const loadController = (state) => {
  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath) {
      if (request === '../../models') {
        return {
          MarketplaceEventModel: {
            findOne: () => ({ lean: async () => state.event }),
            updateOne: async () => {
              state.salesCloseMutationAttempts += 1;
              return { modifiedCount: 1 };
            },
          },
          MarketplaceTicketModel: {
            findOneAndUpdate: (query, update) => ({
              select: async () => {
                const ticket = state.tickets.find(
                  (candidate) =>
                    candidate.event_id === query.event_id &&
                    candidate.token_hash === query.token_hash &&
                    candidate.status === query.status
                );
                if (!ticket) return null;
                Object.assign(ticket, update.$set);
                return ticket;
              },
            }),
            countDocuments: async (query) => {
              state.salesCloseCountAttempts += 1;
              return state.tickets.filter(
                (ticket) => ticket.event_id === query.event_id && ticket.status === query.status
              ).length;
            },
          },
          MarketplaceTicketOrderModel: {},
          MarketplaceScannerSessionModel: {
            findOneAndUpdate: () => ({
              select: async () => ({
                _id: 'scanner-session-1',
                event_id: state.event.event_id,
                coordinator_user_id: state.event.customer_user_id,
              }),
            }),
          },
          MarketplaceAttachmentModel: {},
          UserModel: {},
        };
      }
      if (request === '../../helper/event-ticket-helper') {
        return { isScannerAvailable: () => true };
      }
      if (request === '../../helper/ticket-token-helper') {
        return { hashTicketToken: (token) => `hash-${token}` };
      }
      if (request === '../../config') return { server: {} };
      if (
        request.startsWith('../../helper/') ||
        request.startsWith('../services/')
      ) return {};
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

const createState = (ticketCount) => ({
  salesCloseCountAttempts: 0,
  salesCloseMutationAttempts: 0,
  event: {
    event_id: 'event-1',
    customer_user_id: 'coordinator-1',
    status: 'AWARDED',
    ticket_sales_enabled: true,
    ticket_sales_closed_at: null,
    ticket_scanning_closed_at: null,
    event_date: '2026-08-20',
    event_time: '7:00 PM',
    event_timezone: 'America/New_York',
  },
  tickets: Array.from({ length: ticketCount }, (_, index) => ({
    event_id: 'event-1',
    token_hash: `hash-ticket-${index + 1}`,
    status: 'ACTIVE',
    attendee_label: `Guest ${index + 1}`,
    ticket_type: 'GA',
  })),
});

const scan = async (state, token) => {
  const controller = loadController(state);
  let response;
  let error;
  await controller.validateTicket(
    {
      params: { eventId: 'event-1' },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
      body: { ticket_token: token },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { response, error };
};

const publicScan = async (state, token) => {
  const controller = loadController(state);
  let response;
  let error;
  await controller.publicValidateTicket(
    {
      body: {
        event_id: 'event-1',
        scanner_session_token: 'scanner-session-token',
        ticket_token: token,
      },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { response, error };
};

(async () => {
  let state = createState(2);
  let result = await scan(state, 'ticket-1');
  assert.equal(result.error, undefined);
  assert.equal(result.response.payload.valid, true);
  assert.equal(state.event.ticket_sales_closed_at, null);

  result = await scan(state, 'ticket-2');
  assert.equal(result.error, undefined);
  assert.equal(state.event.ticket_sales_closed_at, null);
  assert.equal(state.salesCloseCountAttempts, 0);
  assert.equal(state.salesCloseMutationAttempts, 0);
  assert.equal(state.event.status, 'AWARDED');
  assert.equal(state.event.ticket_scanning_closed_at, null);

  state = createState(1);
  result = await scan(state, 'ticket-1');
  assert.equal(result.error, undefined);
  assert.equal(state.event.ticket_sales_closed_at, null);
  assert.equal(state.salesCloseCountAttempts, 0);
  assert.equal(state.salesCloseMutationAttempts, 0);
  assert.equal(state.event.status, 'AWARDED');
  assert.equal(state.event.ticket_scanning_closed_at, null);

  state = createState(1);
  result = await publicScan(state, 'ticket-1');
  assert.equal(result.error, undefined);
  assert.equal(result.response.payload.valid, true);
  assert.equal(state.event.ticket_sales_closed_at, null);
  assert.equal(state.salesCloseCountAttempts, 0);
  assert.equal(state.salesCloseMutationAttempts, 0);

  console.log('marketplace ticket scanning lifecycle controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
