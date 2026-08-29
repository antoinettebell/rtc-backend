const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;
const actualLifecycle = require('../../helper/marketplace-submission-lifecycle');
const actualRevocation = require('../../helper/marketplace-award-revocation');
const { hasFoodVendorAwardCapacity } = require('../../helper/marketplace-event-visibility-helper');

const futureEvent = () => ({
  event_id: 'event-1', customer_user_id: 'coordinator-1', event_name: 'Festival',
  status: 'OPEN', vendor_applications_closed_at: null,
  event_close_date: new Date('2030-09-01T00:00:00.000Z'),
  event_date: '2030-09-10T00:00:00.000Z', event_time: '4:00 PM',
  event_duration_hours: 4, event_timezone: 'America/New_York',
  award_payment_id: null, award_payment_status: 'NOT_REQUIRED',
  number_of_vendors_needed: 1, service_type: 'Food Truck',
});

const run = async (handler, { params, body = {}, user = { _id: 'coordinator-1', userType: 'CUSTOMER' } }) => {
  let response;
  let error;
  await handler(
    { user, params, body },
    { data: (payload, message) => { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { response, error };
};

const loadController = (state) => {
  const counters = state.counters;
  const services = {
    UserService: {
      getById: async () => ({
        _id: 'coordinator-1', isEventCoordinator: true,
        eventCoordinatorTaxIdEncrypted: 'encrypted-tax-id',
      }),
    },
    FoodTruckService: {},
    MarketplaceEventService: {
      getByData: async () => state.event,
      update: async () => state.event,
      getModel: () => ({ updateMany: async () => undefined }),
    },
    MarketplaceBidService: {
      getByData: async (query) => query.bid_id === state.bid?.bid_id ? state.bid : [],
      update: async (query, update) => {
        counters.bidUpdates += 1;
        Object.assign(state.bid, update);
        return state.bid;
      },
      getModel: () => ({
        updateMany: async () => { counters.otherBidUpdates += 1; },
      }),
    },
    MarketplaceApplicationService: {
      getByData: async (query) => {
        if (!state.application) return query.application_id ? null : [];
        if (query.application_id && query.application_id !== state.application.application_id) return null;
        return state.application;
      },
      update: async (query, update) => {
        counters.applicationUpdates += 1;
        Object.assign(state.application, update);
        return state.application;
      },
    },
    MarketplacePaymentService: {
      getByData: async () => state.payment || null,
      update: async (query, update) => {
        if (state.paymentRaceToPaid) {
          state.payment.payment_status = 'PAID';
          return null;
        }
        counters.paymentUpdates += 1;
        Object.assign(state.payment, update);
        return state.payment;
      },
      create: async () => { counters.paymentCreates += 1; return {}; },
      getModel: () => ({
        findOneAndUpdate: async (query, update) => {
          if (!state.payment || query.payment_id !== state.payment.payment_id) return null;
          if (query.payment_status && state.payment.payment_status !== query.payment_status) return null;
          if (query.refund_status && state.payment.refund_status !== query.refund_status) return null;
          if (query.refund_processed_by_user_id && String(state.payment.refund_processed_by_user_id) !== String(query.refund_processed_by_user_id)) return null;
          if (query.$or && !['NOT_REQUESTED', 'FAILED', undefined].includes(state.payment.refund_status)) return null;
          Object.assign(state.payment, update.$set || {});
          counters.paymentUpdates += 1;
          return state.payment;
        },
      }),
    },
    MarketplaceAttachmentService: {}, MarketplaceAgreementAuditService: {},
    MarketplaceEventImageService: {}, MarketplaceEventQuestionService: {},
    MarketplaceFileAuditService: {}, MarketplacePaymentAuditService: {},
    MarketplaceVendorAgreementService: {}, VendorComplianceDocumentService: {},
  };
  const mocks = {
    '../services': services,
    '../services/vendor-compliance-service': {},
    '../services/operational-compliance-form-service': {},
    '../../helper/aws': {}, '../../helper/cybersource-refund-helper': {
      processRefund: async () => {
        counters.refunds += 1;
        return state.refundSuccess
          ? { success: true, refundTransactionId: 'refund-1', mode: 'refund' }
          : { success: false, message: 'Gateway declined refund' };
      },
    },
    '../../helper/cybersource-payment-helper': {}, '../../helper/docusign-helper': {},
    '../../helper/marketplace-vendor-agreement-reconciliation': {},
    '../../helper/marketplace-agreement-vendor-context': {},
    '../../helper/marketplace-communications-helper': {
      sendMarketplaceCommunication: async ({ userId }) => {
        counters.notifications += 1;
        counters.notificationUserIds.push(String(userId));
      },
      sendMarketplaceCommunications: async () => { counters.notifications += 1; },
    },
    '../../helper/mail-helper': {},
    '../../helper/marketplace-award-email-helper': {
      buildFoodVendorAwardDetailsHtml: () => '', buildEventVendorAwardDetailsHtml: () => '',
    },
    '../../helper/marketplace-coordinator-details-email': {},
    '../../helper/marketplace-vendor-contact-helper': {},
    '../../helper/marketplace-event-close-helper': require('../../helper/marketplace-event-close-helper'),
    '../../helper/marketplace-award-revocation': actualRevocation,
    '../../helper/public-marketplace-event-helper': {},
    '../../helper/marketplace-tax-exemption-helper': {},
    '../../helper/marketplace-payment-policy-helper': {},
    '../../config': { docusign: {} },
    '../../models': { EventVendorApplicationModel: {}, EventVendorProfileModel: {}, OperationalNotificationModel: {} },
    '../../helper/marketplace-submission-lifecycle': actualLifecycle,
    '../../helper/marketplace-event-visibility-helper': {},
    '../../helper/marketplace-participation-helper': {},
    '../../helper/marketplace-content-moderation': {},
    '../../helper/marketplace-message-context-helper': {},
    '../../helper/marketplace-message-thread-helper': {},
    '../../helper/marketplace-image-contact-moderation': {},
    '../../helper/event-coordinator-profile': {},
    '../../helper/vendor-plan-helper': {},
  };
  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath && Object.prototype.hasOwnProperty.call(mocks, request)) {
      return mocks[request];
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
};

const createState = ({ bidStatus = null, applicationStatus = null, paymentStatus = null } = {}) => {
  const counters = {
    bidSaves: 0, bidUpdates: 0, otherBidUpdates: 0, applicationSaves: 0,
    applicationUpdates: 0, paymentUpdates: 0, paymentCreates: 0,
    eventSaves: 0, notifications: 0, refunds: 0,
    notificationUserIds: [],
  };
  const event = futureEvent();
  event.save = async () => { counters.eventSaves += 1; };
  const bid = bidStatus ? {
    bid_id: 'bid-1', event_id: event.event_id, vendor_user_id: 'vendor-1',
    bid_status: bidStatus, linked_application_id: applicationStatus ? 'application-1' : null,
    save: async () => { counters.bidSaves += 1; },
  } : null;
  const application = applicationStatus ? {
    application_id: 'application-1', event_id: event.event_id,
    vendor_user_id: 'vendor-1', application_status: applicationStatus,
    payment_status: paymentStatus || 'NOT_REQUIRED', archived_at: null,
    save: async () => { counters.applicationSaves += 1; },
  } : null;
  const payment = paymentStatus && paymentStatus !== 'NOT_REQUIRED' ? {
    payment_id: 'payment-1', application_id: 'application-1',
    payment_type: 'VENDOR_EVENT_FEE', payment_status: paymentStatus,
    processor_transaction_id: 'transaction-1', total_amount: 25,
    refund_status: 'NOT_REQUESTED',
  } : null;
  return { counters, event, bid, application, payment, paymentRaceToPaid: false, refundSuccess: true };
};

(async () => {
  for (const [kind, status, expectedStatus] of [
    ['bid', 'SUBMITTED', 'DECLINED'],
    ['application', 'UNDER_REVIEW', 'NOT_SELECTED'],
  ]) {
    const state = createState(kind === 'bid'
      ? { bidStatus: status }
      : { applicationStatus: status });
    const controller = loadController(state);
    const result = await run(
      kind === 'bid' ? controller.declineBid : controller.declineApplication,
      { params: kind === 'bid' ? { bidId: 'bid-1' } : { applicationId: 'application-1' } }
    );
    assert.equal(result.error, undefined);
    assert.equal(
      kind === 'bid' ? state.bid.bid_status : state.application.application_status,
      expectedStatus
    );
    assert.equal(state.counters.notifications, 1);
    assert.deepEqual(state.counters.notificationUserIds, ['vendor-1']);
    assert.equal(state.counters.paymentCreates, 0);
    assert.equal(hasFoodVendorAwardCapacity({
      event: state.event,
      bids: state.bid ? [state.bid] : [],
      applications: state.application ? [state.application] : [],
    }), true, 'terminal rejection releases the Food Vendor capacity slot');
  }

  {
    const state = createState({ applicationStatus: 'UNDER_REVIEW' });
    state.event.status = 'AWARDED';
    const controller = loadController(state);
    const result = await run(controller.declineApplication, {
      params: { applicationId: 'application-1' },
    });
    assert.equal(result.error, undefined, 'a pending submission remains rejectable after another vendor is awarded');
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.equal(state.counters.notifications, 1);
  }

  {
    const state = createState({ bidStatus: 'DECLINED' });
    const controller = loadController(state);
    const result = await run(controller.declineBid, { params: { bidId: 'bid-1' } });
    assert.equal(result.error, undefined);
    assert.match(result.response.message, /already declined/);
    assert.equal(state.counters.notifications, 0);
    const withdrawResult = await run(controller.withdrawBid, {
      params: { bidId: 'bid-1' },
      user: { _id: 'vendor-1', userType: 'VENDOR' },
    });
    assert.equal(withdrawResult.error?.code, 400);
    assert.equal(state.bid.bid_status, 'DECLINED');
    assert.equal(state.counters.bidSaves, 0);
  }

  {
    const state = createState({ applicationStatus: 'NOT_SELECTED' });
    const controller = loadController(state);
    const result = await run(controller.declineApplication, {
      params: { applicationId: 'application-1' },
    });
    assert.equal(result.error, undefined);
    assert.match(result.response.message, /already not selected/);
    assert.equal(state.counters.notifications, 0);
    assert.equal(state.counters.paymentCreates, 0);
  }

  {
    const state = createState({ bidStatus: 'AWARDED' });
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.bid.bid_status, 'NOT_AWARDED');
    assert.ok(state.bid.award_revoked_at instanceof Date);
    assert.equal(state.event.status, 'REOPENED');
    assert.equal(state.counters.bidSaves, 1);
    assert.equal(state.counters.notifications, 1);
    assert.deepEqual(state.counters.notificationUserIds, ['vendor-1']);
    assert.equal(state.counters.paymentCreates, 0);
  }

  {
    const state = createState({ bidStatus: 'AWARDED' });
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    state.event.event_date = startAt.toISOString();
    state.event.event_time = `${String(startAt.getUTCHours()).padStart(2, '0')}:${String(startAt.getUTCMinutes()).padStart(2, '0')}`;
    state.event.event_timezone = 'UTC';
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error?.code, 409);
    assert.match(result.error.message, /within 72 hours/);
    assert.equal(state.bid.bid_status, 'AWARDED');
    assert.equal(state.counters.bidSaves, 0);
    assert.equal(state.counters.notifications, 0);
  }

  {
    const state = createState({
      bidStatus: 'AWARDED', applicationStatus: 'PAID', paymentStatus: 'PAID',
    });
    const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    state.event.event_date = startAt.toISOString();
    state.event.event_time = `${String(startAt.getUTCHours()).padStart(2, '0')}:${String(startAt.getUTCMinutes()).padStart(2, '0')}`;
    state.event.event_timezone = 'UTC';
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error?.code, 409);
    assert.equal(state.counters.refunds, 0);
    assert.equal(state.payment.payment_status, 'PAID');
    assert.equal(state.bid.bid_status, 'AWARDED');
  }

  {
    const state = createState({
      bidStatus: 'AWARDED', applicationStatus: 'PAID', paymentStatus: 'PAID',
    });
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.counters.refunds, 1);
    assert.equal(state.payment.payment_status, 'REFUNDED');
    assert.equal(state.bid.bid_status, 'NOT_AWARDED');
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.ok(state.bid.award_revoked_at instanceof Date);
    assert.ok(state.application.award_revoked_at instanceof Date);
    assert.equal(state.counters.notifications, 1);
  }

  {
    const state = createState({
      bidStatus: 'AWARDED', applicationStatus: 'PAID', paymentStatus: 'PAID',
    });
    state.refundSuccess = false;
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error?.code, 502);
    assert.match(result.error.message, /Gateway declined refund/);
    assert.equal(state.bid.bid_status, 'AWARDED');
    assert.equal(state.application.application_status, 'PAID');
    assert.equal(state.payment.payment_status, 'PAID');
    assert.equal(state.payment.refund_status, 'FAILED');
    assert.equal(state.counters.notifications, 0);
  }

  {
    const state = createState({
      bidStatus: 'AWARDED', applicationStatus: 'PAYMENT_DUE', paymentStatus: 'PENDING',
    });
    state.paymentRaceToPaid = true;
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.counters.refunds, 1);
    assert.equal(state.payment.payment_status, 'REFUNDED');
    assert.equal(state.bid.bid_status, 'NOT_AWARDED');
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.equal(state.counters.notifications, 1);
  }

  {
    const state = createState({
      bidStatus: 'AWARDED', applicationStatus: 'PAYMENT_DUE', paymentStatus: 'PENDING',
    });
    const controller = loadController(state);
    const result = await run(controller.revokeAward, {
      params: { eventId: 'event-1', bidId: 'bid-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.payment.payment_status, 'CANCELLED');
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.equal(state.application.payment_status, 'CANCELLED');
    assert.ok(state.application.award_revoked_at instanceof Date);
    assert.equal(state.bid.bid_status, 'NOT_AWARDED');
    assert.equal(state.counters.paymentUpdates, 1);
    assert.equal(state.counters.applicationSaves, 1);
    assert.equal(state.counters.bidSaves, 1);
    assert.equal(state.counters.notifications, 1);
  }

  {
    const state = createState({ applicationStatus: 'CONFIRMED' });
    const controller = loadController(state);
    const result = await run(controller.revokeApplicationAward, {
      params: { eventId: 'event-1', applicationId: 'application-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.equal(state.application.payment_status, 'CANCELLED');
    assert.equal(state.counters.applicationSaves, 1);
    assert.equal(state.counters.notifications, 1);
    assert.deepEqual(state.counters.notificationUserIds, ['vendor-1']);
    assert.equal(state.counters.paymentCreates, 0);
  }

  {
    const state = createState({ applicationStatus: 'PAID', paymentStatus: 'PAID' });
    const controller = loadController(state);
    const result = await run(controller.revokeApplicationAward, {
      params: { eventId: 'event-1', applicationId: 'application-1' }, body: {},
    });
    assert.equal(result.error, undefined);
    assert.equal(state.counters.refunds, 1);
    assert.equal(state.payment.payment_status, 'REFUNDED');
    assert.equal(state.application.application_status, 'NOT_SELECTED');
    assert.equal(state.counters.notifications, 1);
  }

  {
    const state = createState({ applicationStatus: 'PAID', paymentStatus: 'PAID' });
    state.refundSuccess = false;
    const controller = loadController(state);
    const result = await run(controller.revokeApplicationAward, {
      params: { eventId: 'event-1', applicationId: 'application-1' }, body: {},
    });
    assert.equal(result.error?.code, 502);
    assert.equal(state.application.application_status, 'PAID');
    assert.equal(state.payment.payment_status, 'PAID');
    assert.equal(state.payment.refund_status, 'FAILED');
    assert.equal(state.counters.notifications, 0);
  }

  {
    const state = createState({ applicationStatus: 'PAYMENT_DUE', paymentStatus: 'PENDING' });
    state.paymentRaceToPaid = true;
    const controller = loadController(state);
    const result = await run(controller.revokeApplicationAward, {
      params: { eventId: 'event-1', applicationId: 'application-1' }, body: {},
    });
    assert.equal(result.error?.code, 409);
    assert.match(result.error.message, /not yet a completed award/i);
    assert.equal(state.counters.refunds, 0);
    assert.equal(state.application.application_status, 'PAYMENT_DUE');
    assert.equal(state.payment.payment_status, 'PENDING');
    assert.equal(state.counters.notifications, 0);
  }

  console.log('marketplace rejection and revocation controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
