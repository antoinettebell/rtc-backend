const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;

const matchesStatus = (value, condition) => {
  if (typeof condition === 'string') return value === condition;
  if (condition?.$in) return condition.$in.includes(value);
  return true;
};

const loadController = (state) => {
  const services = {
    FoodTruckService: {},
    MarketplaceApplicationService: { getByData: async () => [] },
    MarketplaceAttachmentService: {},
    MarketplaceAgreementAuditService: {},
    MarketplaceBidService: {
      getByData: async (query, options = {}) => {
        const matches = state.bids.filter(
          (bid) =>
            (!query.event_id || bid.event_id === query.event_id) &&
            (!query.bid_id || bid.bid_id === query.bid_id) &&
            (!query.bid_status || matchesStatus(bid.bid_status, query.bid_status)) &&
            (query.archived_at === undefined || bid.archived_at === query.archived_at)
        );
        return options.singleResult ? matches[0] || null : matches;
      },
    },
    MarketplaceEventImageService: {},
    MarketplaceEventQuestionService: { updateMany: async () => undefined },
    MarketplaceEventService: {
      getByData: async (query, options = {}) => {
        const matches =
          (!query.event_id || query.event_id === state.event.event_id) &&
          (!query.customer_user_id || query.customer_user_id === state.event.customer_user_id)
            ? [state.event]
            : [];
        return options.singleResult ? matches[0] || null : matches;
      },
      update: async (query, update) => {
        Object.assign(state.event, update);
        return state.event;
      },
    },
    MarketplaceFileAuditService: {},
    MarketplacePaymentAuditService: {},
    MarketplacePaymentService: {
      getByData: async (query, options = {}) => {
        const matches = state.payments.filter(
          (payment) =>
            (!query.payment_id || payment.payment_id === query.payment_id) &&
            (!query.event_id || payment.event_id === query.event_id) &&
            (!query.payer_user_id || String(payment.payer_user_id) === String(query.payer_user_id)) &&
            (!query.payment_type || payment.payment_type === query.payment_type) &&
            (!query.payment_status || matchesStatus(payment.payment_status, query.payment_status))
        );
        return options.singleResult ? matches[0] || null : matches;
      },
      getModel: () => ({}),
    },
    MarketplaceVendorAgreementService: {},
    UserService: {
      getById: async (userId) => ({
        _id: userId,
        email: 'coordinator@example.com',
        firstName: 'Coordinator',
        isEventCoordinator: true,
        eventCoordinatorTaxIdEncrypted: 'encrypted',
      }),
    },
    VendorComplianceDocumentService: {},
  };

  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath) {
      if (request === '../services') return services;
      if (request === '../../helper/marketplace-communications-helper') {
        return {
          sendMarketplaceCommunication: async () => undefined,
          sendMarketplaceCommunications: async () => undefined,
        };
      }
      if (request === '../../helper/mail-helper') {
        return { sendMail: async () => { state.receipts += 1; } };
      }
      if (request === '../../helper/vendor-plan-helper') {
        return { canUseCashPOS: () => true, canUseTapToPay: () => true };
      }
      if (request === '../../helper/marketplace-payment-policy-helper') {
        return { isMarketplacePaymentMethodAllowed: () => true };
      }
      if (request === '../../models') {
        return { EventVendorApplicationModel: { find: () => ({ lean: async () => [] }) } };
      }
      if (request === '../../helper/marketplace-award-email-helper') {
        return { buildFoodVendorAwardDetailsHtml: () => '', buildEventVendorAwardDetailsHtml: () => '' };
      }
      if (
        request === '../services/vendor-compliance-service' ||
        request === '../services/operational-compliance-form-service' ||
        request === '../../helper/aws' ||
        request === '../../helper/cybersource-payment-helper' ||
        request === '../../helper/docusign-helper' ||
        request === '../../helper/marketplace-vendor-agreement-reconciliation' ||
        request === '../../helper/marketplace-agreement-vendor-context' ||
        request === '../../helper/marketplace-coordinator-details-email' ||
        request === '../../helper/marketplace-vendor-contact-helper' ||
        request === '../../helper/public-marketplace-event-helper' ||
        request === '../../helper/marketplace-tax-exemption-helper' ||
        request === '../../helper/marketplace-submission-lifecycle' ||
        request === '../../helper/marketplace-content-moderation' ||
        request === '../../helper/marketplace-message-context-helper' ||
        request === '../../helper/marketplace-message-thread-helper' ||
        request === '../../helper/marketplace-image-contact-moderation' ||
        request === '../../helper/event-coordinator-profile' ||
        request === '../../helper/marketplace-participation-helper'
      ) return {};
      if (request === '../../config') return { docusign: {} };
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

const createState = ({ bids = [], payments = [], status = 'AWARDED' } = {}) => ({
  event: {
    event_id: 'event-1',
    customer_user_id: 'coordinator-1',
    event_name: 'Test Event',
    status,
    ticket_sales_enabled: true,
    ticket_sales_closed_at: null,
    vendor_applications_closed_at: null,
    final_payment_status: 'NOT_REQUIRED',
  },
  bids,
  payments,
  receipts: 0,
});

const bid = (bidId) => ({
  bid_id: bidId,
  event_id: 'event-1',
  bid_status: 'AWARDED',
  full_bid_amount: 100,
  archived_at: null,
  award_revoked_at: null,
});
const payment = (bidId) => ({
  payment_id: `payment-${bidId}`,
  event_id: 'event-1',
  bid_id: bidId,
  payer_user_id: 'coordinator-1',
  payer_type: 'CUSTOMER',
  food_truck_id: `truck-${bidId}`,
  payment_type: 'FINAL_EVENT_PAYMENT',
  payment_status: 'PAID',
  total_amount: 100,
});

const runClose = async (state) => {
  const controller = loadController(state);
  let response;
  let error;
  await controller.closeEvent(
    {
      params: { eventId: 'event-1' },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
      body: { close_comment: 'Complete' },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { response, error };
};

const runPaidCheckout = async (state, paidPayment) => {
  const controller = loadController(state);
  let response;
  let error;
  await controller.checkoutPayment(
    {
      params: { paymentId: paidPayment.payment_id },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
      body: { payment_method: 'APPLE_PAY', expected_total: paidPayment.total_amount },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { response, error };
};

(async () => {
  let state = createState({ bids: [bid('bid-1')] });
  let result = await runClose(state);
  assert.equal(result.error?.code, 409);
  assert.equal(state.event.status, 'AWARDED');

  state = createState();
  result = await runClose(state);
  assert.equal(result.error, undefined);
  assert.equal(state.event.status, 'CLOSED');
  assert.equal(state.event.ticket_sales_closed_at, null);

  state = createState({ bids: [bid('bid-1')], payments: [payment('bid-1')] });
  result = await runClose(state);
  assert.equal(result.error, undefined);
  assert.equal(state.event.status, 'CLOSED');

  state = createState({
    bids: [bid('bid-1'), bid('bid-2')],
    payments: [payment('bid-1')],
  });
  result = await runPaidCheckout(state, state.payments[0]);
  assert.equal(result.error, undefined);
  assert.equal(state.event.status, 'AWARDED');
  assert.equal(state.event.final_payment_status, 'PENDING');

  state.payments.push(payment('bid-2'));
  result = await runPaidCheckout(state, state.payments[1]);
  assert.equal(result.error, undefined);
  assert.equal(state.event.status, 'CLOSED');
  assert.equal(state.event.final_payment_status, 'PAID');
  assert.equal(state.event.ticket_sales_closed_at, null);

  console.log('marketplace event completion controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
