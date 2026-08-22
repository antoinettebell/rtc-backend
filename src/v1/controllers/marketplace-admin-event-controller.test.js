const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;
const noopModule = new Proxy({}, { get: () => () => undefined });

const createQuery = (value) => {
  const query = {
    populate() { return query; },
    sort() { return query; },
    session() { return query; },
    lean() { return Promise.resolve(value); },
    exec() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
  return query;
};

const baseEvent = {
  event_id: 'event-1',
  customer_user_id: 'coordinator-1',
  status: 'OPEN',
  event_name: 'Admin Event',
  event_type: 'Festival',
  event_visibility: 'PUBLIC',
  event_style: 'Casual',
  primary_service_style: 'Food Truck',
  service_type: 'Food Truck',
  service_types: ['Food Truck'],
  service_styles: ['Food Truck'],
  event_date: new Date('2026-09-02T00:00:00.000Z'),
  event_time: '06:00 PM',
  event_close_date: new Date('2026-09-01T20:00:00.000Z'),
  event_close_time: '04:00 PM',
  event_timezone: 'America/New_York',
  event_duration_minutes: 240,
  event_address: '1 Main St',
  event_city: 'Columbia',
  event_state: 'SC',
  number_of_guests: 100,
  vip_section_enabled: false,
  vip_guest_count: 0,
  number_of_vendors_needed: 2,
  free_food_offered: false,
  fully_catered_event: true,
  catered_vip_section_enabled: false,
  ga_food_sales_allowed: false,
  separate_vip_vendor_required: false,
  waive_vendor_fee_for_combined_award: false,
  budgeted_amount: 2500,
  vendor_fee: 0,
  vendor_fee_payment_deadline: null,
  payment_responsibility: 'COORDINATOR',
  ga_ticket_quantity: 100,
  vip_ticket_quantity: 0,
  ticket_sales_enabled: true,
  ga_ticket_price: 10,
  vip_ticket_price: 0,
  event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 2, fee: 10 }],
};

const createEvent = (overrides = {}) => ({
  ...baseEvent,
  saveCalls: 0,
  async save() { this.saveCalls += 1; },
  toObject() {
    return Object.fromEntries(Object.entries(this).filter(([, value]) => typeof value !== 'function'));
  },
  ...overrides,
});

const loadController = ({ event = createEvent(), activityCount = 0 } = {}) => {
  const audits = [];
  const createdEvents = [];
  let draft = null;
  const session = {
    async withTransaction(callback) { return callback(); },
    async endSession() {},
  };
  const EventModel = {
    schema: { path: () => ({}) },
    async create(values) {
      const created = values.map((value) => createEvent(value));
      createdEvents.push(...created);
      return created;
    },
    findOne: () => createQuery(event),
  };
  const serviceNames = [
    'FoodTruckService', 'MarketplaceApplicationService', 'MarketplaceAttachmentService',
    'MarketplaceAgreementAuditService', 'MarketplaceBidService', 'MarketplaceEventImageService',
    'MarketplaceEventQuestionService', 'MarketplaceFileAuditService',
    'MarketplacePaymentAuditService', 'MarketplacePaymentService',
    'MarketplaceVendorAgreementService', 'VendorComplianceDocumentService',
  ];
  const services = Object.fromEntries(serviceNames.map((name) => [name, {}]));
  services.MarketplaceEventService = {
    getByData: async () => event,
    getModel: () => EventModel,
  };
  services.UserService = {
    getById: async () => ({
      _id: 'coordinator-1',
      isEventCoordinator: true,
      eventCoordinatorTaxIdEncrypted: 'encrypted',
    }),
  };
  const countModel = { countDocuments: () => createQuery(activityCount) };
  const models = {
    EventVendorApplicationModel: countModel,
    EventVendorProfileModel: {},
    MarketplaceAdminAuditModel: {
      async create(values) { audits.push(...values); },
    },
    MarketplaceAdminDraftModel: {
      findOne: () => createQuery(draft),
      async findOneAndUpdate(filter, update) {
        draft = {
          draft_key: update.$set.draft_key,
          ...update.$set,
          created_at: draft?.created_at || new Date(),
        };
        return draft;
      },
      deleteOne() {
        return { async session() { draft = null; } };
      },
    },
    MarketplaceApplicationModel: countModel,
    MarketplaceAttachmentModel: {},
    MarketplaceBidModel: countModel,
    MarketplacePaymentModel: countModel,
    OperationalNotificationModel: {},
  };

  Module._load = (request, parent, isMain) => {
    if (parent?.filename === controllerPath) {
      if (request === 'mongoose') {
        const mongoose = originalLoad(request, parent, isMain);
        return new Proxy(mongoose, {
          get(target, property) {
            if (property === 'startSession') return async () => session;
            return target[property];
          },
        });
      }
      if (request === '../services') return services;
      if (request === '../../models') return models;
      if (request === '../../config') return { docusign: {} };
      if (request === '../../helper/marketplace-admin-event-policy') {
        return originalLoad(request, parent, isMain);
      }
      if (request === '../../helper/marketplace-event-close-helper') {
        return {
          combineMarketplaceDateAndTime: () => new Date('2026-09-01T20:00:00.000Z'),
          isMarketplaceCloseBeforeEvent: () => true,
        };
      }
      if (request === '../../helper/marketplace-tax-exemption-helper') {
        return { resolveMarketplaceTaxExemptionUpdate: () => ({}) };
      }
      if (request === '../../helper/marketplace-event-visibility-helper') {
        return {
          getAllowedMarketplaceVendorCount: (payload) =>
            Number(payload.number_of_vendors_needed || 0),
        };
      }
      if (request === '../../helper/marketplace-participation-helper') {
        return {
          getMarketplaceBudgetGuestCount: (payload) =>
            Number(payload.number_of_guests || 0),
        };
      }
      if (request === '../../helper/event-coordinator-profile') {
        return { buildTaxIdUpdate: () => ({}) };
      }
      if (request.startsWith('../../helper/') || request.startsWith('../services/')) {
        return noopModule;
      }
    }
    return originalLoad(request, parent, isMain);
  };
  delete require.cache[require.resolve(controllerPath)];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return {
    audits,
    controller,
    createdEvents,
    getDraft: () => draft,
  };
};

const execute = async (method, body, options = {}) => {
  const harness = loadController(options);
  let response;
  let error;
  await harness.controller[method](
    {
      params: { eventId: 'event-1' },
      user: { _id: 'admin-1', userType: 'SUPER_ADMIN' },
      body,
    },
    { data(payload, message) { response = { payload, message }; } },
    (nextError) => { error = nextError; }
  );
  return { ...harness, error, response };
};

(async () => {
  const createDraft = await execute('adminCreateEvent', {
    customer_user_id: 'coordinator-1',
    event_name: 'Draft Event',
    event_type: 'Festival',
    event_visibility: 'PUBLIC',
    save_mode: 'DRAFT',
  });
  assert.equal(createDraft.error, undefined);
  assert.equal(createDraft.createdEvents.length, 0);
  assert.equal(createDraft.audits.length, 0);
  assert.equal(createDraft.getDraft().payload.event_name, 'Draft Event');

  const publishedCreate = await execute('adminCreateEvent', {
    ...baseEvent,
    customer_user_id: 'coordinator-1',
    admin_reason: 'Create on coordinator behalf',
    save_mode: 'PUBLISH',
  });
  assert.equal(publishedCreate.error, undefined);
  assert.equal(publishedCreate.createdEvents.length, 1);
  assert.equal(publishedCreate.audits.length, 1);
  assert.equal(publishedCreate.audits[0].action, 'CREATE_EVENT');
  assert.equal(publishedCreate.getDraft(), null);

  const draftEvent = createEvent();
  const updateDraft = await execute('adminUpdateEvent', {
    event_name: 'Saved Draft Name',
    admin_reason: 'Keep work in progress',
    save_mode: 'DRAFT',
  }, { event: draftEvent });
  assert.equal(updateDraft.error, undefined);
  assert.equal(draftEvent.event_name, 'Admin Event');
  assert.equal(draftEvent.saveCalls, 0);
  assert.equal(updateDraft.audits.length, 0);
  assert.equal(updateDraft.getDraft().payload.event_name, 'Saved Draft Name');

  const reducedEvent = createEvent();
  const invalidPublish = await execute('adminUpdateEvent', {
    ga_ticket_quantity: 99,
    admin_reason: 'Invalid reduction',
    save_mode: 'PUBLISH',
  }, { event: reducedEvent });
  assert.equal(invalidPublish.error?.code, 409);
  assert.equal(reducedEvent.ga_ticket_quantity, 100);
  assert.equal(reducedEvent.saveCalls, 0);
  assert.equal(invalidPublish.audits.length, 0);
  assert.equal(invalidPublish.getDraft().payload.ga_ticket_quantity, 99);
  assert.match(invalidPublish.getDraft().validation_errors[0].message, /only stay the same or increase/i);

  const validEvent = createEvent();
  const validPublish = await execute('adminUpdateEvent', {
    event_name: 'Admin Corrected Event',
    ga_ticket_quantity: 120,
    number_of_vendors_needed: 3,
    event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 3, fee: 10 }],
    admin_reason: 'Coordinator requested correction',
    save_mode: 'PUBLISH',
  }, { event: validEvent });
  assert.equal(validPublish.error, undefined);
  assert.equal(validEvent.event_name, 'Admin Corrected Event');
  assert.equal(validEvent.ga_ticket_quantity, 120);
  assert.equal(validEvent.saveCalls, 1);
  assert.equal(validPublish.audits.length, 1);
  assert.equal(validPublish.audits[0].action, 'UPDATE_EVENT');
  assert.equal(validPublish.getDraft(), null);

  const lockedEvent = createEvent();
  const lockedPublish = await execute('adminUpdateEvent', {
    budgeted_amount: 3000,
    admin_reason: 'Attempt protected change',
    save_mode: 'PUBLISH',
  }, { event: lockedEvent, activityCount: 1 });
  assert.equal(lockedPublish.error?.code, 409);
  assert.equal(lockedEvent.budgeted_amount, 2500);
  assert.equal(lockedEvent.saveCalls, 0);
  assert.equal(lockedPublish.audits.length, 0);
  assert.ok(lockedPublish.getDraft().validation_errors.some(({ field }) => field === 'budgeted_amount'));

  const activityEvent = createEvent({ status: 'AWARDED' });
  const addedVendorNeed = await execute('adminUpdateEvent', {
    event_vendor_needs: [
      { vendor_type: 'MERCHANDISE', quantity: 2, fee: 10 },
      {
        vendor_type: 'SERVICE',
        type_description: 'Event photography',
        quantity: 1,
        fee: 25,
      },
    ],
    admin_reason: 'Add service vendor after applications',
    save_mode: 'PUBLISH',
  }, { event: activityEvent, activityCount: 1 });
  assert.equal(addedVendorNeed.error, undefined);
  assert.equal(activityEvent.status, 'REOPENED');
  assert.equal(activityEvent.event_vendor_needs.length, 2);

  console.log('marketplace admin event controller tests passed');
})().catch((error) => {
  Module._load = originalLoad;
  console.error(error);
  process.exitCode = 1;
});
