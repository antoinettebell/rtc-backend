const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-ticket-controller.js');
const originalLoad = Module._load;

const event = {
  event_id: 'event-guest-ticket',
  event_name: 'Public Festival',
  event_city: 'Buffalo',
  event_state: 'NY',
  customer_user_id: 'coordinator-1',
  ticket_sales_enabled: true,
  ticket_sales_closed_at: null,
  status: 'OPEN',
  ga_ticket_price: 10,
  ga_ticket_quantity: 100,
  ga_tickets_sold: 0,
  ga_tickets_reserved: 0,
  vip_ticket_price: 25,
  vip_ticket_quantity: 10,
  vip_tickets_sold: 0,
  vip_tickets_reserved: 0,
  tax_exemption_status: 'NOT_REQUESTED',
  event_type: 'Festival',
  event_visibility: 'PUBLIC',
};

let createdOrderPayload;
let chargedPayment;
let smsPayload;
let emailDelivery;
let publicEventEligible = true;
let lastEventFindQuery;
let shareLinkUpdate;
const activeEventImages = [{ image_id: 'event-image-1', image_url: 'https://images.example/event.png' }];

const queryFor = (value) => ({
  select() { return this; },
  lean: async () => value,
});

const orderModel = {
  findOne: async () => null,
  create: async (payload) => {
    createdOrderPayload = payload;
    return {
      ...payload,
      ticket_order_id: 'guest-order-1',
      save: async () => undefined,
    };
  },
};

const models = {
  MarketplaceEventModel: {
    findOne: (query) => {
      lastEventFindQuery = query;
      return queryFor(event);
    },
    findOneAndUpdate: async (query, update) => {
      shareLinkUpdate = { query, update };
      return event;
    },
  },
  MarketplaceTicketOrderModel: orderModel,
  MarketplaceTicketModel: {},
  MarketplaceScannerSessionModel: {},
  MarketplaceAttachmentModel: {},
  MarketplaceEventImageModel: {
    find: () => ({
      sort() { return this; },
      lean: async () => activeEventImages,
    }),
  },
  UserModel: {},
};

const ticketService = {
  reserveEventInventory: async () => event,
  reservationExpiry: () => new Date('2099-01-01T00:00:00.000Z'),
  releaseReservation: async () => undefined,
  confirmReservation: async () => undefined,
  createTicketsForPaidOrder: async () => [{
    ticket: { ticket_id: 'ticket-1', attendee_label: 'Guest 1', ticket_type: 'GA' },
    url: 'https://tickets.example/t/one',
  }],
};

Module._load = (request, parent, isMain) => {
  if (parent?.filename === controllerPath) {
    if (request === '../../models') return models;
    if (request === '../services/marketplace-ticket-service') return ticketService;
    if (request === '../../helper/payment-helper') return {
      chargePaymentUnified: async (payload) => {
        chargedPayment = payload;
        return { success: true, transactionId: 'transaction-1' };
      },
    };
    if (request === '../../helper/tax-helper') return {
      calculateEventTicketTax: async () => ({ success: true, totalTax: 0 }),
      commitAvalaraTransaction: async () => ({ success: true }),
    };
    if (request === '../../helper/event-ticket-helper') return {
      calculateTicketAmounts: ({ unitPrice, quantity }) => ({
        ticketSubtotal: Number(unitPrice) * Number(quantity),
        customerProcessingFee: 0,
        coordinatorProcessingFee: 0,
      }),
      getAdmissionsTaxCode: () => 'P0000000',
      getEntityUseCode: () => null,
      cancellationDeadline: () => new Date(),
      assertInventoryAvailable: () => undefined,
      encodeWalletPaymentToken: () => 'opaque-token',
      isScannerAvailable: () => true,
    };
    if (request === '../../helper/ticket-token-helper') return {
      hashTicketToken: (token) => `hashed-${token}`,
      createTicketToken: () => ({ token: 'token', tokenHash: 'hash' }),
      buildPublicTicketUrl: () => 'https://tickets.example/t/one',
    };
    if (request === '../../config') return {
      server: {
        publicTicketBaseURL: 'https://tickets.example',
        customerIosAppStoreURL: 'https://apps.example/customer',
        customerAndroidPlayStoreURL: 'https://play.example/store?id=com.example.customer',
      },
    };
    if (request === '../../helper/aws') return {};
    if (request === '../../helper/encryption') return {};
    if (request === '../../helper/public-ticket-page') return {};
    if (request === '../../helper/ticket-qr-helper') return {
      buildTicketQrDataUrl: async () => 'data:image/png;base64,page-qr',
      buildTicketQrEmailAttachment: async ({ ticketId }) => ({
        contentId: `rtc-ticket-${ticketId}`,
        attachment: {
          content: 'email-qr',
          filename: `rtc-ticket-${ticketId}.png`,
          type: 'image/png',
          disposition: 'inline',
          content_id: `rtc-ticket-${ticketId}`,
        },
      }),
    };
    if (request === '../../helper/sms-helper') return {
      sendSms: async (payload) => { smsPayload = payload; return { sent: true }; },
    };
    if (request === '../../helper/mail-helper') return {
      sendMail: async (recipient, subject, html, options) => {
        emailDelivery = { recipient, subject, html, options };
        return { sent: true };
      },
    };
    if (request === '../../helper/public-marketplace-event-helper') return {
      isPublicMarketplaceEventEligible: () => publicEventEligible,
      isPublicTicketPurchaseAvailable: () => publicEventEligible,
      sanitizePublicMarketplaceEvent: (value) => value,
    };
  }
  return originalLoad(request, parent, isMain);
};

delete require.cache[require.resolve(controllerPath)];
const controller = require(controllerPath);
Module._load = originalLoad;

const requestBody = {
  ga_quantity: 1,
  vip_quantity: 0,
  purchaser: {
    first_name: 'Guest',
    last_name: 'Buyer',
    email: 'guest@example.com',
    phone: '+15555550123',
  },
  billing_address: {
    line1: '1 Main Street',
    city: 'Buffalo',
    region: 'NY',
    postalCode: '14201',
    country: 'US',
  },
  payment_method: 'APPLE_PAY',
  payment_data: { token: 'wallet-token' },
  idempotency_key: '10f38a80-8ee6-4c10-a28c-03bd6254917a',
};

(async () => {
  let response;
  let error;
  await controller.guestCheckout(
    { params: { shareToken: 'private-share-token' }, body: requestBody },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );

  assert.equal(error, undefined);
  assert.equal(response.message, 'Ticket purchase confirmed');
  assert.equal(lastEventFindQuery.event_date, undefined, 'share links are not event-date limited');
  assert.equal(lastEventFindQuery.$and[0].$or.length, 2, 'legacy and retained link hashes remain valid');
  assert.equal(createdOrderPayload.customer_user_id, null, 'guest checkout does not manufacture an account');
  assert.equal(createdOrderPayload.purchaser_name, 'Guest Buyer');
  assert.equal(createdOrderPayload.purchaser_email, 'guest@example.com');

  assert.equal(createdOrderPayload.purchaser_phone, '+15555550123');
  assert.equal(createdOrderPayload.coordinator_processing_fee, 0);
  assert.equal(
    createdOrderPayload.net_coordinator_payout,
    10,
    'in-app ticket proceeds must not deduct external payout fees or collected tax'
  );
  assert.equal(chargedPayment.userId, 'guest-order-1', 'processor reference uses the durable ticket order');
  assert.equal(chargedPayment.email, 'guest@example.com');
  assert.equal(smsPayload.to, '+15555550123');
  assert.equal(emailDelivery.recipient, 'guest@example.com');
  assert.equal(emailDelivery.subject, 'Your Tickets for Public Festival');
  assert.match(emailDelivery.html, /cid:rtc-ticket-ticket-1/);
  assert.match(emailDelivery.html, /Open secure ticket/);
  assert.equal(emailDelivery.options.attachments.length, 1);
  assert.equal(emailDelivery.options.attachments[0].content_id, 'rtc-ticket-ticket-1');

  response = undefined;
  error = undefined;
  await controller.publicGuestQuote(
    { params: { eventId: event.event_id }, body: requestBody },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  assert.equal(error, undefined);
  assert.equal(response.message, 'Ticket quote calculated');
  assert.equal(response.payload.quote.totalAmount, 10);

  createdOrderPayload = undefined;
  response = undefined;
  error = undefined;
  await controller.publicGuestCheckout(
    { params: { eventId: event.event_id }, body: { ...requestBody, idempotency_key: 'public-event-guest-key' } },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  assert.equal(error, undefined);
  assert.equal(response.message, 'Ticket purchase confirmed');
  assert.equal(createdOrderPayload.customer_user_id, null, 'public-event checkout remains account-free');
  assert.equal(createdOrderPayload.purchaser_email, 'guest@example.com');

  publicEventEligible = false;
  createdOrderPayload = undefined;
  error = undefined;
  await controller.publicGuestCheckout(
    { params: { eventId: event.event_id }, body: { ...requestBody, idempotency_key: 'private-event-guest-key' } },
    { data: () => { throw new Error('Ineligible public checkout must not respond successfully'); } },
    (nextError) => { error = nextError; }
  );
  assert.equal(error?.code, 404);
  assert.equal(createdOrderPayload, undefined, 'ineligible event creates no guest ticket order');
  publicEventEligible = true;

  response = undefined;
  error = undefined;
  await controller.getTicketInvitationEvent(
    { params: { shareToken: 'private-share-token' } },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  assert.equal(error, undefined);
  assert.equal(response.message, 'Private ticket invitation');
  assert.deepEqual(response.payload.marketplaceEvent.images, activeEventImages);

  let html;
  await controller.publicTicketInvitation(
    { params: { shareToken: 'private-share-token' } },
    {
      set: () => undefined,
      type: () => ({ send: (value) => { html = value; } }),
      status: () => ({ send: () => undefined }),
    },
    (nextError) => { throw nextError; }
  );
  assert.match(html, /Download on the App Store/);
  assert.match(html, /Get it on Google Play/);
  assert.match(html, /Download the app to buy tickets/);
  assert.match(html, /I already have the app — Open this event/);
  assert.match(html, /rtc-customer:\/\/invite\/private-share-token/);
  assert.match(html, /rtc_ticket_share%3Dprivate-share-token/);
  assert.match(html, /After signing up, we will return you to this event/);
  assert.doesNotMatch(html, /window\.location\.assign/);

  let shareResponse;
  await controller.createTicketShareLink(
    { params: { eventId: event.event_id }, user: { _id: 'coordinator-1' } },
    { data: (payload) => { shareResponse = payload; } },
    (nextError) => { throw nextError; }
  );
  assert.match(shareResponse.share_url, /\/events\//);
  assert(Array.isArray(shareLinkUpdate.update));
  const shareSet = shareLinkUpdate.update[0].$set;
  assert.equal(shareSet.ticket_share_token_hashes.$setUnion[1][0], shareSet.ticket_share_token_hash);
  assert.deepEqual(
    shareSet.ticket_share_token_hashes.$setUnion[2].$cond[1],
    ['$ticket_share_token_hash'],
    'new links preserve the previously issued legacy hash'
  );

  models.MarketplaceEventModel.findOne = () => queryFor(null);
  let unavailablePage;
  let unavailableStatus;
  await controller.publicTicketInvitation(
    { params: { shareToken: 'expired-share-token' } },
    {
      set: () => undefined,
      status: (status) => {
        unavailableStatus = status;
        return {
          type: () => ({ send: (value) => { unavailablePage = value; } }),
        };
      },
    },
    (nextError) => { throw nextError; }
  );
  assert.equal(unavailableStatus, 404);
  assert.match(unavailablePage, /Tickets are no longer available to purchase/);
  assert.match(unavailablePage, /font-size:30px/);

  console.log('marketplace guest ticket checkout controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
