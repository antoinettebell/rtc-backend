const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;
const actualParticipation = require('../../helper/marketplace-participation-helper');
const actualAwardBatch = require('../../helper/marketplace-award-batch');

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
      (!query.application_id || application.application_id === query.application_id) &&
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
    MarketplacePaymentAuditService: {},
    MarketplacePaymentService: {},
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
      if (request === '../../helper/marketplace-regression-test-fees') return { getCoordinatorAwardFeeAmount: () => 0 };
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
        EventVendorApplicationModel: { find: () => ({ lean: async () => [] }) },
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
      if (request === '../../helper/marketplace-vendor-contact-helper' || request === '../../helper/marketplace-event-close-helper' || request === '../../helper/marketplace-award-revocation' || request === '../../helper/marketplace-vendor-fee-refund') return {};
      if (request === '../../helper/public-marketplace-event-helper' || request === '../../helper/marketplace-tax-exemption-helper' || request === '../../helper/marketplace-payment-policy-helper') return {};
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

const createState = () => ({
  event: {
    event_id: 'event-1', customer_user_id: 'coordinator-1', event_name: 'Test Event',
    status: 'OPEN', number_of_vendors_needed: 2, payment_responsibility: 'COORDINATOR',
    marketplace_payment_responsibility: 'COORDINATOR', event_vendor_needs: [],
    agreement_status: 'NOT_REQUIRED', save: async () => undefined,
  },
  bids: [createBid('bid-1', 'vendor-1'), createBid('bid-2', 'vendor-2'), createBid('bid-3', 'vendor-3')],
  applications: [], outcomes: [], emails: [], notifications: 0, questionArchives: 0,
});

const award = async (controller, bidIds) => {
  let response;
  let capturedError;
  await controller.awardBids(
    {
      params: { eventId: 'event-1' }, user: { _id: 'coordinator-1' },
      body: { bid_ids: bidIds, award_selections: bidIds.map((bidId) => ({ bid_id: bidId, award_coverage: 'REGULAR' })) },
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
  assert.equal(state.bids[2].bid_status, 'NOT_AWARDED', 'remaining bid closes only when capacity fills');
  assert.equal(state.event.status, 'AWARDED');
  assert.equal(second.response.payload.remaining_food_vendor_awards, 0);
  assert.equal(state.questionArchives, 1);
  assert.equal(state.outcomes.filter((message) => message.title.includes('not selected')).length, 1);

  const overCapacity = await award(controller, ['bid-3']);
  assert.equal(overCapacity.error?.code, 409, 'capacity-closed event cannot accept another award');

  const batchState = createState();
  const batchController = loadController(batchState);
  const batch = await award(batchController, ['bid-1', 'bid-2']);
  assert.equal(batch.error, undefined, 'multiple selected bids can still be awarded in one checkout batch');
  assert.equal(batchState.event.status, 'AWARDED');

  const legacyState = createState();
  legacyState.bids[0].bid_status = 'AWARDED';
  legacyState.event.status = 'AWARDED';
  const legacyController = loadController(legacyState);
  const legacyNextAward = await award(legacyController, ['bid-2']);
  assert.equal(legacyNextAward.error, undefined, 'a legacy partial AWARDED event is reconciled for its remaining slot');
  assert.equal(legacyState.bids[1].bid_status, 'AWARDED');
  assert.equal(legacyState.bids[2].bid_status, 'NOT_AWARDED');

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
  assert.equal(applicationState.applications[2].application_status, 'NOT_SELECTED');
  assert.equal(applicationState.event.status, 'AWARDED');

  console.log('marketplace incremental award controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
