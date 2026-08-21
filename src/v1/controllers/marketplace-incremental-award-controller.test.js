const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;
const actualParticipation = require('../../helper/marketplace-participation-helper');
const actualAwardBatch = require('../../helper/marketplace-award-batch');
const actualEventClose = require('../../helper/marketplace-event-close-helper');

const matchesStatus = (value, condition) => {
  if (typeof condition === 'string') return value === condition;
  if (condition?.$in) return condition.$in.includes(value);
  if (condition?.$nin) return !condition.$nin.includes(value);
  return true;
};

const loadController = (state) => {
  const bidService = {
    getByData: async (query) => state.bids.filter((bid) =>
      (!query.event_id || bid.event_id === query.event_id) &&
      (!query.bid_id?.$in || query.bid_id.$in.includes(bid.bid_id)) &&
      (!query.bid_status || matchesStatus(bid.bid_status, query.bid_status)) &&
      (query.archived_at === undefined || bid.archived_at === query.archived_at)
    ),
    getModel: () => ({
      updateMany: async (query, update) => {
        state.bids.forEach((bid) => {
          if (
            bid.event_id === query.event_id &&
            matchesStatus(bid.bid_status, query.bid_status) &&
            (query.archived_at === undefined || bid.archived_at === query.archived_at)
          ) Object.assign(bid, update.$set || {});
        });
      },
    }),
  };
  const applicationService = {
    getByData: async (query, options = {}) => {
      const matches = state.applications.filter((application) =>
      application.event_id === query.event_id &&
      (!query.application_id || (
        query.application_id.$in
          ? query.application_id.$in.includes(application.application_id)
          : application.application_id === query.application_id
      )) &&
      (!query.application_status || matchesStatus(application.application_status, query.application_status)) &&
      (query.archived_at === undefined || application.archived_at === query.archived_at)
      );
      return options.singleResult ? matches[0] || null : matches;
    },
    getModel: () => ({
      updateMany: async (query, update) => {
        state.applications.forEach((application) => {
          if (
            application.event_id === query.event_id &&
            matchesStatus(application.application_status, query.application_status) &&
            (query.archived_at === undefined || application.archived_at === query.archived_at)
          ) Object.assign(application, update.$set || {});
        });
      },
    }),
  };
  const services = {
    FoodTruckService: {},
    MarketplaceApplicationService: applicationService,
    MarketplaceAttachmentService: { getByData: async () => [] },
    MarketplaceAgreementAuditService: {},
    MarketplaceBidService: bidService,
    MarketplaceEventImageService: {},
    MarketplaceEventQuestionService: {
      updateMany: async () => { state.questionArchives += 1; },
    },
    MarketplaceEventService: {
      getByData: async () => state.event,
      update: async (query, update) => {
        Object.assign(state.event, update);
        return state.event;
      },
    },
    MarketplaceFileAuditService: {},
    MarketplacePaymentAuditService: { create: async () => undefined },
    MarketplacePaymentService: {
      getByData: async (query, options = {}) => {
        const matches = state.payments.filter((payment) =>
          (!query.payment_id || payment.payment_id === query.payment_id) &&
          (!query.event_id || payment.event_id === query.event_id) &&
          (!query.payer_user_id || String(payment.payer_user_id) === String(query.payer_user_id)) &&
          (!query.application_id || payment.application_id === query.application_id) &&
          (!query.payment_type || payment.payment_type === query.payment_type) &&
          (!query.payment_status || matchesStatus(payment.payment_status, query.payment_status))
        );
        return options.singleResult ? matches[0] || null : matches;
      },
      create: async (payload) => {
        const payment = {
          payment_id: `payment-${state.payments.length + 1}`,
          ...payload,
          save: async () => undefined,
        };
        state.payments.push(payment);
        return payment;
      },
    },
    MarketplaceVendorAgreementService: { getByData: async () => null },
    UserService: {
      getById: async (id) => ({
        _id: id,
        email: `${id}@example.com`,
        firstName: String(id),
        isEventCoordinator: String(id) === 'coordinator-1',
        eventCoordinatorTaxIdEncrypted: String(id) === 'coordinator-1' ? 'encrypted-tax-id' : null,
      }),
    },
    VendorComplianceDocumentService: {},
  };

  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath) {
      if (request === '../services') return services;
      if (request === '../../helper/marketplace-award-batch') return actualAwardBatch;
      if (request === '../../helper/marketplace-participation-helper') return actualParticipation;
      if (request === '../../helper/marketplace-regression-test-fees') return {
        getCoordinatorAwardFeeAmount: () => state.coordinatorFee,
        getMarketplaceVendorApplicationCheckoutFeeAmount: () => 0.01,
      };
      if (request === '../../helper/marketplace-communications-helper') return {
        sendMarketplaceCommunication: async () => { state.notifications += 1; },
        sendMarketplaceCommunications: async (messages) => { state.outcomes.push(...messages); },
      };
      if (request === '../../helper/mail-helper') return {
        sendMail: async (recipient) => { state.emails.push(recipient); },
      };
      if (request === '../../helper/marketplace-award-email-helper') return {
        buildFoodVendorAwardDetailsHtml: () => '<p>award</p>',
        buildEventVendorAwardDetailsHtml: () => '<p>award</p>',
      };
      if (request === '../../models') return {
        EventVendorApplicationModel: {
          find: (query) => {
            const matches = state.eventVendorApplications.filter((application) =>
              application.event_id === query.event_id &&
              (!query.application_id?.$in || query.application_id.$in.includes(application.application_id)) &&
              (!query.status || matchesStatus(application.status, query.status))
            );
            return {
              lean: async () => matches,
              then: (resolve, reject) => Promise.resolve(matches).then(resolve, reject),
            };
          },
        },
      };
      if (request === '../../helper/vendor-plan-helper') return {
        canAccessEventMarketplace: () => true,
        canUseCashPOS: () => true,
        canUseTapToPay: () => true,
      };
      if (request === '../services/vendor-compliance-service' || request === '../services/operational-compliance-form-service') return {};
      if (request === '../../helper/aws' || request === '../../helper/payment-helper' || request === '../../helper/cybersource-payment-helper' || request === '../../helper/docusign-helper') return {};
      if (request === '../../helper/marketplace-agreement-email-attachments') return { buildAgreementEmailAttachments: async () => [], excludeAgreementDocuments: (items) => items };
      if (request === '../../helper/marketplace-vendor-agreement-reconciliation' || request === '../../helper/marketplace-agreement-document-verification' || request === '../../helper/marketplace-agreement-vendor-context') return {};
      if (request === '../../helper/marketplace-coordinator-details-email') return {};
      if (request === '../../helper/marketplace-event-close-helper') return actualEventClose;
      if (request === '../../helper/marketplace-vendor-contact-helper' || request === '../../helper/marketplace-award-revocation' || request === '../../helper/marketplace-vendor-fee-refund') return {};
      if (request === '../../helper/marketplace-payment-policy-helper') return {
        isMarketplacePaymentMethodAllowed: () => true,
      };
      if (request === '../../helper/public-marketplace-event-helper' || request === '../../helper/marketplace-tax-exemption-helper') return {};
      if (request === '../../config') return { docusign: {} };
      if (request === '../../helper/marketplace-submission-lifecycle') return {};
      if (request === '../../helper/marketplace-event-visibility-helper') return { isFoodVendorMarketplaceEvent: () => true };
      if (request === '../../helper/marketplace-content-moderation' || request === '../../helper/marketplace-message-context-helper' || request === '../../helper/marketplace-message-thread-helper' || request === '../../helper/marketplace-image-contact-moderation' || request === '../../helper/event-coordinator-profile') return {};
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

const createBid = (id, vendorId) => ({
  bid_id: id,
  event_id: 'event-1',
  vendor_user_id: vendorId,
  food_truck_id: `truck-${vendorId}`,
  bid_status: 'SUBMITTED',
  guest_coverage: 'REGULAR',
  full_bid_amount: 100,
  archived_at: null,
  save: async () => undefined,
});

const createApplication = (id, vendorId) => ({
  application_id: id,
  event_id: 'event-1',
  vendor_user_id: vendorId,
  application_status: 'SUBMITTED',
  payment_status: 'NOT_REQUIRED',
  archived_at: null,
  save: async () => undefined,
});

const createEventVendorApplication = (id, vendorId, type = 'MERCHANDISE') => ({
  application_id: id,
  event_id: 'event-1',
  vendor_user_id: vendorId,
  profile_id: `profile-${vendorId}`,
  vendor_types: [type],
  status: 'SUBMITTED',
  checkout_subtotal: 25,
  save: async () => undefined,
});

const createState = () => ({
  event: {
    event_id: 'event-1', customer_user_id: 'coordinator-1', event_name: 'Test Event',
    status: 'OPEN', number_of_vendors_needed: 2, payment_responsibility: 'COORDINATOR',
    marketplace_payment_responsibility: 'COORDINATOR', event_vendor_needs: [],
    agreement_status: 'NOT_REQUIRED', save: async () => undefined,
  },
  bids: [createBid('bid-1', 'vendor-1'), createBid('bid-2', 'vendor-2'), createBid('bid-3', 'vendor-3')],
  applications: [], eventVendorApplications: [], payments: [], coordinatorFee: 0,
  outcomes: [], emails: [], notifications: 0, questionArchives: 0,
});

const award = async (controller, bidIds, overrides = {}) => {
  let response;
  let capturedError;
  await controller.awardBids(
    {
      params: { eventId: 'event-1' }, user: { _id: 'coordinator-1' },
      body: {
        bid_ids: bidIds,
        food_application_ids: overrides.foodApplicationIds || [],
        event_vendor_application_ids: overrides.eventVendorApplicationIds || [],
        award_selections: bidIds.map((bidId) => ({ bid_id: bidId, award_coverage: 'REGULAR' })),
      },
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (error) => { capturedError = error; }
  );
  return { response, error: capturedError };
};

const awardApplication = async (controller, applicationId) => {
  let response;
  let capturedError;
  await controller.acceptApplication(
    {
      params: { eventId: 'event-1', applicationId },
      user: { _id: 'coordinator-1' }, body: {},
    },
    { data: (payload, message) => { response = { payload, message }; } },
    (error) => { capturedError = error; }
  );
  return { response, error: capturedError };
};

(async () => {
  const state = createState();
  const controller = loadController(state);

  const first = await award(controller, ['bid-1']);
  assert.equal(first.error, undefined);
  assert.equal(state.bids[0].bid_status, 'AWARDED');
  assert.equal(state.bids[1].bid_status, 'SUBMITTED', 'untouched bid stays actionable');
  assert.equal(state.bids[2].bid_status, 'SUBMITTED', 'all untouched bids remain actionable');
  assert.equal(state.event.status, 'OPEN', 'event stays open while award capacity remains');
  assert.equal(first.response.payload.remaining_food_vendor_awards, 1);
  assert.equal(state.outcomes.filter((message) => message.title.includes('accepted')).length, 1);
  assert.equal(state.outcomes.filter((message) => message.title.includes('not selected')).length, 0);
  assert.ok(state.emails.includes('coordinator-1@example.com'), 'coordinator receives the awarded bid email');

  state.outcomes.length = 0;
  const second = await award(controller, ['bid-2']);
  assert.equal(second.error, undefined);
  assert.equal(state.bids[1].bid_status, 'AWARDED');
  assert.equal(state.bids[2].bid_status, 'SUBMITTED', 'untouched bid remains pending for an explicit coordinator decision');
  assert.equal(state.event.status, 'AWARDED');
  assert.equal(second.response.payload.remaining_food_vendor_awards, 0);
  assert.equal(state.questionArchives, 1);
  assert.equal(state.outcomes.filter((message) => message.title.includes('not selected')).length, 0);

  const overCapacity = await award(controller, ['bid-3']);
  assert.equal(overCapacity.error?.code, 409, 'capacity-closed event cannot accept another award');

  const batchState = createState();
  const batchController = loadController(batchState);
  const batch = await award(batchController, ['bid-1', 'bid-2']);
  assert.equal(batch.error, undefined, 'multiple selected bids can still be awarded in one checkout batch');
  assert.equal(batchState.event.status, 'AWARDED');

  const closedState = createState();
  closedState.event.status = 'CLOSED';
  closedState.event.vendor_applications_closed_at = new Date();
  closedState.event.event_close_date = new Date('2020-01-01');
  const closedController = loadController(closedState);
  const closedAward = await award(closedController, ['bid-1']);
  assert.equal(closedAward.error, undefined, 'existing Food Vendor bids remain awardable after bidding closes');
  assert.equal(closedState.bids[0].bid_status, 'AWARDED');

  const legacyState = createState();
  legacyState.bids[0].bid_status = 'AWARDED';
  legacyState.event.status = 'AWARDED';
  const legacyController = loadController(legacyState);
  const legacyNextAward = await award(legacyController, ['bid-2']);
  assert.equal(legacyNextAward.error, undefined, 'a legacy partial AWARDED event is reconciled for its remaining slot');
  assert.equal(legacyState.bids[1].bid_status, 'AWARDED');
  assert.equal(legacyState.bids[2].bid_status, 'SUBMITTED');

  const applicationState = createState();
  applicationState.bids = [];
  applicationState.applications = [
    createApplication('application-1', 'vendor-1'),
    createApplication('application-2', 'vendor-2'),
    createApplication('application-3', 'vendor-3'),
  ];
  const applicationController = loadController(applicationState);
  const firstApplication = await awardApplication(applicationController, 'application-1');
  assert.equal(firstApplication.error, undefined);
  assert.equal(applicationState.applications[0].application_status, 'CONFIRMED');
  assert.equal(applicationState.applications[1].application_status, 'SUBMITTED');
  assert.equal(applicationState.event.status, 'OPEN');
  assert.ok(
    applicationState.emails.includes('coordinator-1@example.com'),
    'coordinator receives an email for the individually awarded Food application'
  );
  const secondApplication = await awardApplication(applicationController, 'application-2');
  assert.equal(secondApplication.error, undefined);
  assert.equal(applicationState.applications[2].application_status, 'SUBMITTED');
  assert.equal(applicationState.event.status, 'AWARDED');

  const batchedFoodApplicationState = createState();
  batchedFoodApplicationState.bids = [];
  batchedFoodApplicationState.applications = [
    createApplication('application-batch', 'vendor-application'),
  ];
  const batchedFoodApplicationController = loadController(batchedFoodApplicationState);
  const batchedFoodApplication = await award(
    batchedFoodApplicationController,
    [],
    { foodApplicationIds: ['application-batch'] }
  );
  assert.equal(batchedFoodApplication.error, undefined);
  assert.equal(
    batchedFoodApplicationState.applications[0].application_status,
    'CONFIRMED',
    'Food applications finalize only through Complete Booking'
  );
  assert.deepStrictEqual(
    batchedFoodApplication.response.payload.awarded_food_application_ids,
    ['application-batch']
  );

  const eventVendorState = createState();
  eventVendorState.event.number_of_vendors_needed = 0;
  eventVendorState.event.service_type = 'Photography';
  eventVendorState.event.service_types = ['Photography'];
  eventVendorState.event.service_styles = ['Photography'];
  eventVendorState.event.event_vendor_needs = [
    { vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
  ];
  eventVendorState.bids = [];
  eventVendorState.eventVendorApplications = [
    createEventVendorApplication('event-application-batch', 'market-vendor'),
  ];
  const eventVendorController = loadController(eventVendorState);
  const eventVendorBatch = await award(eventVendorController, [], {
    eventVendorApplicationIds: ['event-application-batch'],
  });
  assert.equal(eventVendorBatch.error, undefined);
  assert.equal(eventVendorState.eventVendorApplications[0].status, 'PAYMENT_DUE');
  assert.equal(eventVendorState.payments.length, 1, 'vendor checkout is created at Complete Booking');
  assert.equal(
    eventVendorState.payments[0].payer_type,
    'VENDOR',
    'a Marketplace Vendor selection never creates coordinator checkout'
  );
  assert.deepStrictEqual(
    eventVendorBatch.response.payload.awarded_event_vendor_application_ids,
    ['event-application-batch']
  );

  const paidBatchState = createState();
  paidBatchState.coordinatorFee = 0.01;
  paidBatchState.event.event_vendor_needs = [
    { vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
  ];
  paidBatchState.eventVendorApplications = [
    createEventVendorApplication('event-application-paid-batch', 'market-vendor'),
  ];
  const paidBatchController = loadController(paidBatchState);
  const paidBatch = await award(paidBatchController, ['bid-1'], {
    eventVendorApplicationIds: ['event-application-paid-batch'],
  });
  assert.equal(paidBatch.error, undefined);
  assert.equal(paidBatch.response.payload.requires_payment, true);
  assert.equal(paidBatchState.bids[0].bid_status, 'SUBMITTED');
  assert.equal(paidBatchState.eventVendorApplications[0].status, 'SUBMITTED');
  assert.deepStrictEqual(
    paidBatchState.payments[0].selected_event_vendor_application_ids,
    ['event-application-paid-batch'],
    'the coordinator checkout durably retains the Marketplace application selection'
  );
  paidBatchState.payments[0].payment_status = 'PAID';
  let checkoutResponse;
  let checkoutError;
  await paidBatchController.checkoutPayment(
    {
      params: { paymentId: paidBatchState.payments[0].payment_id },
      user: { _id: 'coordinator-1', userType: 'CUSTOMER' },
      body: { payment_method: 'APPLE_PAY', expected_total: 0.01 },
    },
    { data: (payload, message) => { checkoutResponse = { payload, message }; } },
    (error) => { checkoutError = error; }
  );
  assert.equal(checkoutError, undefined);
  assert.equal(paidBatchState.bids[0].bid_status, 'AWARDED');
  assert.equal(
    paidBatchState.eventVendorApplications[0].status,
    'PAYMENT_DUE',
    'the retained Marketplace application finalizes only after coordinator checkout'
  );
  assert.deepStrictEqual(
    checkoutResponse.payload.routingResult.awarded_event_vendor_application_ids,
    ['event-application-paid-batch']
  );

  console.log('marketplace incremental award controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
