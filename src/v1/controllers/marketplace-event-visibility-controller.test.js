const assert = require('assert');
const Module = require('module');
const path = require('path');

const marketplaceControllerPath = path.join(__dirname, 'marketplace-controller.js');
const eventVendorControllerPath = path.join(__dirname, 'event-vendor-controller.js');
const originalLoad = Module._load;

const actualLifecycle = require('../../helper/marketplace-submission-lifecycle');
const actualParticipation = require('../../helper/marketplace-participation-helper');
const actualEventVendorParticipation = require('../../helper/event-vendor-participation-helper');

const futureDate = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const pastDate = () => new Date(Date.now() - 24 * 60 * 60 * 1000);

const queryResult = (value) => ({
	select() { return this; },
	sort() { return this; },
	lean() { return Promise.resolve(value); },
	then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});

const valuesEqual = (left, right) => String(left) === String(right);

const matchesCondition = (value, condition) => {
	if (condition === null) return value == null;
	if (condition instanceof Date) return new Date(value).getTime() === condition.getTime();
	if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
		return Array.isArray(value)
			? value.some((item) => valuesEqual(item, condition))
			: valuesEqual(value, condition);
	}
	if ('$in' in condition) {
		const candidates = condition.$in || [];
		return Array.isArray(value)
			? value.some((item) => candidates.some((candidate) => valuesEqual(item, candidate)))
			: candidates.some((candidate) => valuesEqual(value, candidate));
	}
	if ('$nin' in condition) {
		const candidates = condition.$nin || [];
		return Array.isArray(value)
			? value.every((item) => candidates.every((candidate) => !valuesEqual(item, candidate)))
			: candidates.every((candidate) => !valuesEqual(value, candidate));
	}
	if ('$gt' in condition) return value != null && new Date(value).getTime() > new Date(condition.$gt).getTime();
	if ('$gte' in condition) return value != null && new Date(value).getTime() >= new Date(condition.$gte).getTime();
	if ('$lt' in condition) return value != null && new Date(value).getTime() < new Date(condition.$lt).getTime();
	if ('$lte' in condition) return value != null && new Date(value).getTime() <= new Date(condition.$lte).getTime();
	if ('$ne' in condition) return !valuesEqual(value, condition.$ne);
	if ('$exists' in condition) return condition.$exists ? value !== undefined : value === undefined;
	if ('$elemMatch' in condition) {
		return Array.isArray(value) && value.some((item) => matchesQuery(item, condition.$elemMatch));
	}
	return matchesQuery(value || {}, condition);
};

const matchesQuery = (document, query = {}) => Object.entries(query).every(([key, condition]) => {
	if (key === '$or') return condition.some((entry) => matchesQuery(document, entry));
	return matchesCondition(document && document[key], condition);
});

const runController = async (handler, request) => {
	let response;
	let error;
	await handler(
		request,
		{ data: (payload, message) => { response = { payload, message }; } },
		(nextError) => { error = nextError; }
	);
	return { response, error };
};

const loadWithMocks = (controllerPath, mocks) => {
	try {
		Module._load = (request, parent, isMain) => {
			if (parent && parent.filename === controllerPath && Object.prototype.hasOwnProperty.call(mocks, request)) {
				return mocks[request];
			}
			return originalLoad(request, parent, isMain);
		};
		delete require.cache[require.resolve(controllerPath)];
		return require(controllerPath);
	} finally {
		Module._load = originalLoad;
	}
};

const createCounters = () => ({
	applicationCreates: 0,
	applicationUpdates: 0,
	bidCreates: 0,
	bidUpdates: 0,
	eventVendorCreates: 0,
	eventVendorSaves: 0,
	paymentCreates: 0,
	emails: 0,
	notifications: 0,
	photoUpdates: 0,
	attachmentUpdates: 0,
});

const makeFoodEvent = (eventId, overrides = {}) => ({
	event_id: eventId,
	event_name: eventId,
	status: 'OPEN',
	event_close_date: futureDate(),
	vendor_applications_closed_at: null,
	service_type: 'Food Truck',
	service_types: ['Food Truck'],
	service_styles: ['Food Truck'],
	primary_service_style: 'Food Truck',
	number_of_vendors_needed: 2,
	number_of_guests: 200,
	budgeted_amount: 1000,
	vendor_fee: 50,
	current_submission_round: 1,
	...overrides,
});

const createFoodState = () => ({
	counters: createCounters(),
	tierEligibleByVendor: {},
	complianceByVendor: {},
	users: {},
	foodTrucks: {},
	events: [],
	bids: [],
	applications: [],
});

const getListOrOne = (items, query, options = {}) => {
	const matched = items.filter((item) => matchesQuery(item, query));
	return options.singleResult ? matched[0] || null : matched;
};

const loadMarketplaceController = (state) => {
	const services = {
		UserService: {
			getById: async (userId) => state.users[userId] || null,
			getByData: async () => null,
		},
		FoodTruckService: {
			getByData: async ({ userId }) => state.foodTrucks[userId] || null,
		},
		MarketplaceEventService: {
			getByData: async (query, options = {}) => getListOrOne(state.events, query, options),
			getCount: async (query) => getListOrOne(state.events, query).length,
			update: async (query, payload) => {
				const item = state.events.find((event) => matchesQuery(event, query));
				if (item) Object.assign(item, payload);
				return item;
			},
			attachImages: async (events) => events,
			getModel: () => ({
				updateMany: async (query, update) => {
					state.events.filter((event) => matchesQuery(event, query)).forEach((event) => {
						Object.assign(event, update.$set || {});
					});
				},
			}),
		},
		MarketplaceBidService: {
			getByData: async (query, options = {}) => getListOrOne(state.bids, query, options),
			create: async (payload) => {
				state.counters.bidCreates += 1;
				return { bid_id: `bid-created-${state.counters.bidCreates}`, ...payload };
			},
			update: async (query, payload) => {
				state.counters.bidUpdates += 1;
				const item = state.bids.find((bid) => matchesQuery(bid, query));
				if (item) Object.assign(item, payload);
				return item;
			},
		},
		MarketplaceApplicationService: {
			getByData: async (query, options = {}) => getListOrOne(state.applications, query, options),
			create: async (payload) => {
				state.counters.applicationCreates += 1;
				return { application_id: `application-created-${state.counters.applicationCreates}`, ...payload };
			},
			update: async (query, payload) => {
				state.counters.applicationUpdates += 1;
				const item = state.applications.find((application) => matchesQuery(application, query));
				if (item) Object.assign(item, payload);
				return item;
			},
		},
		MarketplacePaymentService: {
			create: async (payload) => {
				state.counters.paymentCreates += 1;
				return { payment_id: `payment-${state.counters.paymentCreates}`, ...payload };
			},
			getByData: async () => [],
			getModel: () => ({}),
		},
		MarketplaceAttachmentService: { getByData: async () => [] }, MarketplaceAgreementAuditService: {},
		MarketplaceEventImageService: {}, MarketplaceEventQuestionService: {},
		MarketplaceFileAuditService: {}, MarketplacePaymentAuditService: {},
		MarketplaceVendorAgreementService: {}, VendorComplianceDocumentService: { getByData: async () => [] },
	};
	return loadWithMocks(marketplaceControllerPath, {
		'../services': services,
		'../../helper/vendor-plan-helper': {
			canAccessEventMarketplace: (foodTruck) => state.tierEligibleByVendor[foodTruck.userId] !== false,
			canUseCashPOS: () => true,
			canUseTapToPay: () => true,
		},
		'../services/vendor-compliance-service': {
			calculateComplianceSummary: async (foodTruck) => state.complianceByVendor[foodTruck.userId] || { eligible: true, can_bid: true },
		},
		'../services/operational-compliance-form-service': {},
		'../../helper/aws': {},
		'../../helper/payment-helper': {},
		'../../helper/cybersource-payment-helper': {},
		'../../helper/docusign-helper': {},
		'../../helper/marketplace-vendor-agreement-reconciliation': {},
		'../../helper/marketplace-agreement-vendor-context': {},
		'../../helper/marketplace-communications-helper': {
			sendMarketplaceCommunication: async () => { state.counters.notifications += 1; },
			sendMarketplaceCommunications: async () => { state.counters.notifications += 1; },
		},
		'../../helper/mail-helper': { sendMail: async () => { state.counters.emails += 1; } },
		'../../helper/marketplace-award-email-helper': { buildFoodVendorAwardDetailsHtml: () => '', buildEventVendorAwardDetailsHtml: () => '' },
		'../../helper/marketplace-coordinator-details-email': {},
		'../../helper/marketplace-vendor-contact-helper': {
			deriveMarketplaceVendorContact: () => ({ contact_name: 'Vendor', phone: '5555555555', email: 'vendor@example.com' }),
			sanitizeMarketplaceContactForCoordinator: (value) => value,
		},
		'../../helper/marketplace-event-close-helper': { buildVendorEventCloseState: () => ({}), getMarketplaceEventTiming: () => ({}) },
		'../../helper/public-marketplace-event-helper': {},
		'../../helper/marketplace-tax-exemption-helper': {},
		'../../helper/marketplace-payment-policy-helper': { isMarketplacePaymentMethodAllowed: () => true },
		'../../config': { docusign: {} },
		'../../models': { EventVendorApplicationModel: {}, EventVendorProfileModel: {}, OperationalNotificationModel: {} },
		'../../helper/marketplace-submission-lifecycle': actualLifecycle,
		'../../helper/marketplace-participation-helper': actualParticipation,
		'../../helper/marketplace-content-moderation': { moderateMarketplaceText: () => ({ allowed: true }) },
		'../../helper/marketplace-message-context-helper': {},
		'../../helper/marketplace-message-thread-helper': {},
		'../../helper/marketplace-image-contact-moderation': {},
		'../../helper/event-coordinator-profile': {},
	});
};

const addFoodVendor = (state, vendorId, overrides = {}) => {
	state.users[vendorId] = {
		_id: vendorId,
		userType: 'VENDOR',
		requestStatus: 'APPROVED',
		verified: true,
		...overrides.user,
	};
	state.foodTrucks[vendorId] = {
		_id: `truck-${vendorId}`,
		userId: vendorId,
		verified: true,
		...overrides.foodTruck,
	};
	state.tierEligibleByVendor[vendorId] = overrides.tierEligible !== false;
	state.complianceByVendor[vendorId] = overrides.compliance || { eligible: true, can_bid: true };
};

const foodRequest = (vendorId, overrides = {}) => ({
	user: { _id: vendorId, userType: 'VENDOR' },
	query: { limit: 20, page: 1 },
	params: {},
	body: {},
	...overrides,
});

const assertFoodSubmissionUntouched = (state) => {
	assert.equal(state.counters.applicationCreates, 0);
	assert.equal(state.counters.applicationUpdates, 0);
	assert.equal(state.counters.bidCreates, 0);
	assert.equal(state.counters.bidUpdates, 0);
	assert.equal(state.counters.paymentCreates, 0);
	assert.equal(state.counters.emails, 0);
	assert.equal(state.counters.notifications, 0);
};

const makeProfile = (vendorId, vendorTypes) => {
	const value = {
		profile_id: `profile-${vendorId}`,
		vendor_user_id: vendorId,
		status: 'ACTIVE',
		review_status: 'APPROVED',
		business_name: `Business ${vendorId}`,
		vendor_types: vendorTypes,
	};
	return { ...value, toObject: () => ({ ...value }) };
};

const makeEventVendorEvent = (eventId, overrides = {}) => ({
	event_id: eventId,
	event_name: eventId,
	status: 'OPEN',
	event_close_date: futureDate(),
	vendor_applications_closed_at: null,
	payment_responsibility: 'VENDOR',
	event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 }],
	...overrides,
});

const createEventVendorState = () => ({
	counters: createCounters(),
	users: {},
	profiles: {},
	events: [],
	applications: [],
	photos: [],
	images: [],
});

const makeApplicationDocument = (application, state) => ({
	...application,
	photos: application.photos || [],
	save: async function save() {
		state.counters.eventVendorSaves += 1;
		return this;
	},
});

const loadEventVendorController = (state) => {
	const models = {
		EventVendorProfileModel: {
			findOne: (query) => queryResult(Object.values(state.profiles).find((profile) => matchesQuery(profile, query)) || null),
		},
		EventVendorApplicationModel: {
			find: (query) => queryResult(state.applications.filter((application) => matchesQuery(application, query))),
			findOne: (query) => queryResult(state.applications.find((application) => matchesQuery(application, query)) || null),
			updateMany: async () => undefined,
			exists: async () => false,
		},
		EventVendorPhotoModel: {
			find: (query) => queryResult(state.photos.filter((photo) => matchesQuery(photo, query))),
			updateMany: async () => { state.counters.photoUpdates += 1; },
		},
		MarketplaceEventModel: {
			find: (query) => queryResult(state.events.filter((event) => matchesQuery(event, query))),
			findOne: (query) => queryResult(state.events.find((event) => matchesQuery(event, query)) || null),
		},
		UserModel: {
			findById: (userId) => queryResult(state.users[userId] || null),
		},
		MarketplacePaymentModel: {
			create: async () => { state.counters.paymentCreates += 1; return {}; },
		},
		MarketplaceVendorAgreementModel: {
			findOne: () => queryResult({
				agreement_id: 'agreement-1',
				application_id: 'annual-agreement',
				status: 'SIGNED',
				signed_at: new Date(),
				nda_version: '1',
				governance_version: '1',
			}),
			updateOne: async () => undefined,
		},
		MarketplaceAttachmentModel: { updateMany: async () => { state.counters.attachmentUpdates += 1; } },
		MarketplaceAgreementAuditModel: { create: async () => undefined },
		MarketplaceEventImageModel: {
			find: (query) => queryResult(state.images.filter((image) => matchesQuery(image, query))),
		},
		MarketplaceEventQuestionModel: {},
	};
	return loadWithMocks(eventVendorControllerPath, {
		mongoose: {},
		'../../models': models,
		'../../helper/aws': { addObjectWithKey: async () => undefined },
		'../../config': { docusign: {} },
		'../../helper/mail-helper': { sendMail: async () => { state.counters.emails += 1; } },
		'../../helper/marketplace-communications-helper': {
			sendMarketplaceCommunication: async () => { state.counters.notifications += 1; },
		},
		'../../helper/event-vendor-application-idempotency': {
			findOrCreateEventVendorApplication: async ({ payload }) => {
				state.counters.eventVendorCreates += 1;
				const application = makeApplicationDocument({
					application_id: `event-application-${state.counters.eventVendorCreates}`,
					status: 'SUBMITTED',
					...payload,
				}, state);
				state.applications.push(application);
				return { application, created: true };
			},
		},
		'../../helper/event-vendor-profile-lifecycle': {
			MERCHANDISE_CATEGORIES: [],
		},
		'../../helper/event-vendor-photo-counter': {},
		'../../helper/event-vendor-photo-cleanup': {},
		'../../helper/marketplace-agreement-vendor-context': { buildSignedAgreementAttachmentLink: () => ({ query: {}, update: {} }) },
		'../../helper/marketplace-vendor-contact-helper': { sanitizeMarketplaceContactForCoordinator: (value) => value },
		'../../helper/marketplace-submission-lifecycle': actualLifecycle,
		'../../helper/event-vendor-participation-helper': actualEventVendorParticipation,
		'../../helper/external-web-link': { normalizeExternalWebLink: (value) => value, normalizeExternalWebLinks: (value) => value },
	});
};

const eventVendorRequest = (vendorId, eventId, overrides = {}) => ({
	user: { _id: vendorId, userType: 'VENDOR', vendorSubtype: 'EVENT_VENDOR' },
	params: { eventId },
	query: {},
	body: {},
	ip: '127.0.0.1',
	...overrides,
});

const validEventVendorBody = (vendorTypes) => ({
	vendor_types: vendorTypes,
	photo_ids: [],
	offering_bullets: ['Products and services'],
	average_price: 100,
	electricity_required: false,
	participation_path: 'APPLICATION',
});

const assertEventVendorSubmissionUntouched = (state) => {
	assert.equal(state.counters.eventVendorCreates, 0);
	assert.equal(state.counters.eventVendorSaves, 0);
	assert.equal(state.counters.paymentCreates, 0);
	assert.equal(state.counters.emails, 0);
	assert.equal(state.counters.notifications, 0);
	assert.equal(state.counters.photoUpdates, 0);
	assert.equal(state.counters.attachmentUpdates, 0);
};

const runFoodVendorTests = async () => {
	{
		const state = createFoodState();
		state.users.coordinator = {
			_id: 'coordinator',
			isEventCoordinator: true,
			eventCoordinatorTaxIdEncrypted: 'encrypted-tax-id',
		};
		state.events.push(makeFoodEvent('coordinator-event', {
			customer_user_id: 'coordinator',
		}));
		state.bids.push(
			{ bid_id: 'signed-bid', event_id: 'coordinator-event', bid_status: 'SUBMITTED' },
			{ bid_id: 'pending-bid', event_id: 'coordinator-event', bid_status: 'PENDING_SIGNATURE' }
		);
		state.applications.push(
			{ application_id: 'signed-application', event_id: 'coordinator-event', application_status: 'SUBMITTED' },
			{ application_id: 'pending-application', event_id: 'coordinator-event', application_status: 'PENDING_SIGNATURE' }
		);
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.getEventBids, {
			user: { _id: 'coordinator', userType: 'CUSTOMER' },
			params: { eventId: 'coordinator-event' },
			query: {},
			body: {},
		});
		assert.equal(result.error, undefined);
		assert.deepStrictEqual(
			result.response.payload.marketplaceBidList.map((bid) => bid.bid_id),
			['signed-bid'],
			'coordinators must not see Food Vendor bids that have not finished signing'
		);
		assert.deepStrictEqual(
			result.response.payload.marketplaceApplicationList.map((application) => application.application_id),
			['signed-application'],
			'coordinators must not see Food Vendor applications that have not finished signing'
		);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'jazzy');
		addFoodVendor(state, 'pizza');
		state.events.push(makeFoodEvent('shared-event', { event_city: 'Remote City', cuisine_preferences: ['No Match'] }));
		state.bids.push({ bid_id: 'jazzy-bid', event_id: 'shared-event', vendor_user_id: 'jazzy', bid_status: 'SUBMITTED', archived_at: null });
		const controller = loadMarketplaceController(state);
		const pizza = await runController(controller.getOpenEvents, foodRequest('pizza'));
		assert.equal(pizza.error, undefined);
		assert.deepStrictEqual(pizza.response.payload.marketplaceEventList.map((event) => event.event_id), ['shared-event']);
		const jazzy = await runController(controller.getOpenEvents, foodRequest('jazzy'));
		assert.equal(jazzy.error, undefined);
		assert.deepStrictEqual(jazzy.response.payload.marketplaceEventList, []);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'draft-owner');
		state.events.push(makeFoodEvent('both-path-draft', {
			payment_responsibility: 'BOTH',
			vendor_fee: 50,
			budgeted_amount: 1000,
		}));
		state.bids.push({
			bid_id: 'saved-draft', event_id: 'both-path-draft', vendor_user_id: 'draft-owner',
			food_truck_id: 'truck-draft-owner', bid_status: 'DRAFT', archived_at: null,
		});
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.myBids, foodRequest('draft-owner'));
		assert.equal(result.error, undefined);
		assert.deepStrictEqual(
			result.response.payload.marketplaceBidList.map((bid) => [bid.bid_id, bid.bid_status, bid.event_id]),
			[['saved-draft', 'DRAFT', 'both-path-draft']],
			'a saved BOTH-event bid draft remains available through My Bids'
		);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'rejected');
		addFoodVendor(state, 'other');
		state.events.push(makeFoodEvent('rejected-event'));
		state.bids.push({ bid_id: 'declined-bid', event_id: 'rejected-event', vendor_user_id: 'rejected', bid_status: 'DECLINED', archived_at: null, submission_round: 1 });
		const controller = loadMarketplaceController(state);
		const rejectedList = await runController(controller.getOpenEvents, foodRequest('rejected'));
		assert.deepStrictEqual(rejectedList.response.payload.marketplaceEventList, []);
		const otherList = await runController(controller.getOpenEvents, foodRequest('other'));
		assert.deepStrictEqual(otherList.response.payload.marketplaceEventList.map((event) => event.event_id), ['rejected-event']);
		const resubmit = await runController(controller.submitBid, foodRequest('rejected', {
			params: { eventId: 'rejected-event' },
			body: { bid_status: 'SUBMITTED' },
		}));
		assert.equal(resubmit.error && resubmit.error.code, 409);
		assertFoodSubmissionUntouched(state);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'third');
		state.events.push(makeFoodEvent('filled-food'));
		state.bids.push(
			{ bid_id: 'award-1', event_id: 'filled-food', vendor_user_id: 'one', bid_status: 'AWARDED', guest_coverage: 'REGULAR', archived_at: null },
			{ bid_id: 'award-2', event_id: 'filled-food', vendor_user_id: 'two', bid_status: 'AWARDED', guest_coverage: 'REGULAR', archived_at: null }
		);
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.getOpenEvents, foodRequest('third'));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList, []);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'blocked-bidder');
		state.events.push(makeFoodEvent('filled-bid-event', {
			number_of_vendors_needed: 1,
			budgeted_amount: 1000,
		}));
		state.bids.push({
			bid_id: 'existing-award', event_id: 'filled-bid-event', vendor_user_id: 'winner',
			bid_status: 'AWARDED', guest_coverage: 'REGULAR', archived_at: null,
		});
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.submitBid, foodRequest('blocked-bidder', {
			params: { eventId: 'filled-bid-event' },
			body: { bid_status: 'SUBMITTED' },
		}));
		assert.equal(result.error && result.error.code, 409);
		assert.match(result.error.message, /food vendor award capacity/i);
		assertFoodSubmissionUntouched(state);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'blocked-applicant');
		state.events.push(makeFoodEvent('filled-application-event', {
			number_of_vendors_needed: 1,
			vendor_fee: 50,
		}));
		state.applications.push({
			application_id: 'existing-paid-application', event_id: 'filled-application-event',
			vendor_user_id: 'winner', application_status: 'PAID', archived_at: null,
		});
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.submitApplication, foodRequest('blocked-applicant', {
			params: { eventId: 'filled-application-event' },
			body: { application_status: 'SUBMITTED' },
		}));
		assert.equal(result.error && result.error.code, 409);
		assert.match(result.error.message, /food vendor award capacity/i);
		assertFoodSubmissionUntouched(state);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'pagination-vendor');
		state.events.push(
			makeFoodEvent('eligible-page-1-a'),
			makeFoodEvent('non-food-between-pages', {
				service_type: 'Photography', service_types: ['Photography'],
				service_styles: ['Portraits'], primary_service_style: 'Portraits',
			}),
			makeFoodEvent('filled-between-pages', { number_of_vendors_needed: 1 }),
			makeFoodEvent('eligible-page-1-b'),
			makeFoodEvent('eligible-page-2')
		);
		state.bids.push({
			bid_id: 'filled-pagination-award', event_id: 'filled-between-pages', vendor_user_id: 'winner',
			bid_status: 'AWARDED', guest_coverage: 'REGULAR', archived_at: null,
		});
		const controller = loadMarketplaceController(state);
		const firstPage = await runController(controller.getOpenEvents, foodRequest('pagination-vendor', {
			query: { limit: 2, page: 1 },
		}));
		assert.equal(firstPage.error, undefined);
		assert.equal(firstPage.response.payload.total, 3);
		assert.equal(firstPage.response.payload.totalPages, 2);
		assert.deepStrictEqual(
			firstPage.response.payload.marketplaceEventList.map((event) => event.event_id),
			['eligible-page-1-a', 'eligible-page-1-b']
		);
		const secondPage = await runController(controller.getOpenEvents, foodRequest('pagination-vendor', {
			query: { limit: 2, page: 2 },
		}));
		assert.equal(secondPage.error, undefined);
		assert.equal(secondPage.response.payload.total, 3);
		assert.equal(secondPage.response.payload.totalPages, 2);
		assert.deepStrictEqual(
			secondPage.response.payload.marketplaceEventList.map((event) => event.event_id),
			['eligible-page-2']
		);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'qualified');
		state.events.push(
			makeFoodEvent('closed', { status: 'CLOSED' }),
			makeFoodEvent('cancelled', { status: 'CANCELLED' }),
			makeFoodEvent('expired', { event_close_date: pastDate() }),
			makeFoodEvent('submissions-closed', { vendor_applications_closed_at: new Date() }),
			makeFoodEvent('non-food', {
				service_type: 'Photography', service_types: ['Photography'], service_styles: ['Portraits'], primary_service_style: 'Portraits',
				event_vendor_needs: [{ vendor_type: 'SERVICE', quantity: 5 }],
			}),
			makeFoodEvent('catering', {
				service_type: 'Full Service Catering', service_types: ['Full Service Catering'], service_styles: ['Buffet'], primary_service_style: 'Buffet',
				event_city: 'Far Away', cuisine_preferences: ['Cuisine unavailable locally'],
			})
		);
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.getOpenEvents, foodRequest('qualified'));
		assert.equal(result.error, undefined);
		assert.deepStrictEqual(result.response.payload.marketplaceEventList.map((event) => event.event_id), ['catering']);
		assert.equal(result.response.payload.total, 1);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'basic', { tierEligible: false });
		state.events.push(makeFoodEvent('food-event'));
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.getOpenEvents, foodRequest('basic'));
		assert.equal(result.error && result.error.code, 403);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'noncompliant', { compliance: { eligible: false, can_bid: false, message: 'Compliance required' } });
		state.events.push(makeFoodEvent('food-event'));
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.getOpenEvents, foodRequest('noncompliant'));
		assert.equal(result.error && result.error.code, 409);
		assert.match(result.error.message, /Compliance required/);
	}

	{
		const state = createFoodState();
		addFoodVendor(state, 'not-selected');
		state.events.push(makeFoodEvent('application-event'));
		state.applications.push({
			application_id: 'not-selected-app', event_id: 'application-event', vendor_user_id: 'not-selected',
			application_status: 'NOT_SELECTED', submission_round: 1, archived_at: null,
		});
		const controller = loadMarketplaceController(state);
		const result = await runController(controller.submitApplication, foodRequest('not-selected', {
			params: { eventId: 'application-event' },
			body: { application_status: 'SUBMITTED' },
		}));
		assert.equal(result.error && result.error.code, 409);
		assertFoodSubmissionUntouched(state);
	}
};

const addEventVendor = (state, vendorId, vendorTypes) => {
	state.users[vendorId] = {
		_id: vendorId,
		userType: 'VENDOR',
		vendorSubtype: 'EVENT_VENDOR',
		firstName: 'Market',
		lastName: 'Vendor',
	};
	state.profiles[vendorId] = makeProfile(vendorId, vendorTypes);
};

const runMarketplaceVendorTests = async () => {
	{
		const state = createEventVendorState();
		addEventVendor(state, 'application-only-vendor', ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent('application-only-event', {
			payment_responsibility: 'BOTH',
		}));
		const controller = loadEventVendorController(state);
		const result = await runController(controller.submitApplication, eventVendorRequest(
			'application-only-vendor',
			'application-only-event',
			{ body: { ...validEventVendorBody(['MERCHANDISE']), participation_path: 'BID' } }
		));
		assert.equal(result.error && result.error.code, 400);
		assert.match(result.error.message, /applications only/);
		assertEventVendorSubmissionUntouched(state);
	}

	for (const paymentResponsibility of ['COORDINATOR', 'BOTH', 'VENDOR']) {
		const state = createEventVendorState();
		addEventVendor(state, `application-${paymentResponsibility}`, ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent(`application-${paymentResponsibility}-event`, {
			payment_responsibility: paymentResponsibility,
		}));
		const controller = loadEventVendorController(state);
		const result = await runController(controller.submitApplication, eventVendorRequest(
			`application-${paymentResponsibility}`,
			`application-${paymentResponsibility}-event`,
			{ body: validEventVendorBody(['MERCHANDISE']) }
		));
		assert.equal(result.error, undefined);
		assert.equal(result.response.payload.eventVendorApplication.participation_path, 'APPLICATION');
		assert.equal(state.counters.eventVendorCreates, 1);
		assert.equal(state.counters.paymentCreates, 0);
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'nationwide-merchandise', ['MERCHANDISE']);
		state.events.push(
			makeEventVendorEvent('new-york-merchandise', {
				event_city: 'New York', event_state: 'NY',
			}),
			makeEventVendorEvent('virginia-merchandise', {
				event_city: 'Stuart', event_state: 'VA',
			}),
			makeEventVendorEvent('california-merchandise', {
				event_city: 'Los Angeles', event_state: 'CA',
			}),
			makeEventVendorEvent('service-only', {
				event_city: 'New York', event_state: 'NY',
				event_vendor_needs: [{ vendor_type: 'SERVICE', quantity: 1, fee: 25 }],
			})
		);
		const controller = loadEventVendorController(state);
		const result = await runController(
			controller.eligibleEvents,
			eventVendorRequest('nationwide-merchandise', null, {
				query: { city: 'Nowhere', state: 'ZZ', radius: 1 },
			})
		);
		assert.equal(result.error, undefined);
		assert.deepStrictEqual(
			result.response.payload.marketplaceEventList.map((event) => event.event_id).sort(),
			['california-merchandise', 'new-york-merchandise', 'virginia-merchandise'],
			'Marketplace Vendor authorization ignores location and returns every open event requesting an approved type'
		);
	}

	for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'AWARDED', 'NOT_SELECTED', 'PAYMENT_DUE', 'PAID', 'WITHDRAWN']) {
		const state = createEventVendorState();
		addEventVendor(state, 'persisted-owner', ['MERCHANDISE']);
		addEventVendor(state, 'unrelated-vendor', ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent(`persisted-${status}`));
		state.applications.push(makeApplicationDocument({
			application_id: `application-${status}`, event_id: `persisted-${status}`,
			vendor_user_id: 'persisted-owner', profile_id: 'profile-persisted-owner',
			status, vendor_types: ['MERCHANDISE'],
		}, state));
		const controller = loadEventVendorController(state);
		const owner = await runController(controller.eligibleEvents, eventVendorRequest('persisted-owner', null));
		assert.deepStrictEqual(owner.response.payload.marketplaceEventList, [], `${status} must hide the event from its owner`);
		const unrelated = await runController(controller.eligibleEvents, eventVendorRequest('unrelated-vendor', null));
		if (['AWARDED', 'PAYMENT_DUE', 'PAID'].includes(status)) {
			assert.deepStrictEqual(unrelated.response.payload.marketplaceEventList, [], `${status} must consume matching capacity`);
		} else {
			assert.deepStrictEqual(
				unrelated.response.payload.marketplaceEventList.map((event) => event.event_id),
				[`persisted-${status}`],
				`${status} must remain account-specific without consuming capacity`
			);
		}
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'vendor-a', ['MERCHANDISE']);
		addEventVendor(state, 'vendor-b', ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent('shared-market-event'));
		state.applications.push(makeApplicationDocument({
			application_id: 'submitted-a', event_id: 'shared-market-event', vendor_user_id: 'vendor-a',
			profile_id: 'profile-vendor-a', status: 'SUBMITTED', vendor_types: ['MERCHANDISE'],
		}, state));
		const controller = loadEventVendorController(state);
		const vendorA = await runController(controller.eligibleEvents, eventVendorRequest('vendor-a', null));
		assert.equal(vendorA.error, undefined);
		assert.deepStrictEqual(vendorA.response.payload.marketplaceEventList, []);
		const vendorB = await runController(controller.eligibleEvents, eventVendorRequest('vendor-b', null));
		assert.equal(vendorB.error, undefined);
		assert.deepStrictEqual(vendorB.response.payload.marketplaceEventList.map((event) => event.event_id), ['shared-market-event']);
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'not-selected', ['MERCHANDISE']);
		addEventVendor(state, 'other-vendor', ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent('terminal-event'));
		state.applications.push(makeApplicationDocument({
			application_id: 'not-selected-application', event_id: 'terminal-event', vendor_user_id: 'not-selected',
			profile_id: 'profile-not-selected', status: 'NOT_SELECTED', vendor_types: ['MERCHANDISE'],
		}, state));
		const controller = loadEventVendorController(state);
		const hidden = await runController(controller.eligibleEvents, eventVendorRequest('not-selected', null));
		assert.deepStrictEqual(hidden.response.payload.marketplaceEventList, []);
		const visible = await runController(controller.eligibleEvents, eventVendorRequest('other-vendor', null));
		assert.deepStrictEqual(visible.response.payload.marketplaceEventList.map((event) => event.event_id), ['terminal-event']);
		const before = { ...state.applications[0] };
		const resubmit = await runController(controller.submitApplication, eventVendorRequest('not-selected', 'terminal-event', {
			body: validEventVendorBody(['MERCHANDISE']),
		}));
		assert.equal(resubmit.error && resubmit.error.code, 409);
		assert.equal(state.applications[0].status, before.status);
		assertEventVendorSubmissionUntouched(state);
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'submitted-owner', ['MERCHANDISE']);
		addEventVendor(state, 'merch-candidate', ['MERCHANDISE']);
		addEventVendor(state, 'service-candidate', ['SERVICE']);
		state.events.push(makeEventVendorEvent('capacity-event', {
			event_vendor_needs: [
				{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
				{ vendor_type: 'SERVICE', quantity: 1, fee: 15 },
			],
		}));
		state.applications.push(makeApplicationDocument({
			application_id: 'submitted-does-not-fill', event_id: 'capacity-event', vendor_user_id: 'submitted-owner',
			profile_id: 'profile-submitted-owner', status: 'SUBMITTED', vendor_types: ['MERCHANDISE'],
		}, state));
		let controller = loadEventVendorController(state);
		let result = await runController(controller.eligibleEvents, eventVendorRequest('merch-candidate', null));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList.map((event) => event.event_id), ['capacity-event']);

		state.applications.push(makeApplicationDocument({
			application_id: 'awarded-merch', event_id: 'capacity-event', vendor_user_id: 'awarded-vendor',
			profile_id: 'profile-awarded-vendor', status: 'AWARDED', vendor_types: ['MERCHANDISE'],
		}, state));
		controller = loadEventVendorController(state);
		result = await runController(controller.eligibleEvents, eventVendorRequest('merch-candidate', null));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList, []);
		result = await runController(controller.eligibleEvents, eventVendorRequest('service-candidate', null));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList.map((event) => event.event_id), ['capacity-event']);

		state.applications[1].status = 'PAYMENT_DUE';
		controller = loadEventVendorController(state);
		result = await runController(controller.eligibleEvents, eventVendorRequest('merch-candidate', null));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList, []);
		state.applications[1].status = 'PAID';
		controller = loadEventVendorController(state);
		result = await runController(controller.eligibleEvents, eventVendorRequest('merch-candidate', null));
		assert.deepStrictEqual(result.response.payload.marketplaceEventList, []);
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'dual-profile', ['MERCHANDISE', 'SERVICE']);
		state.events.push(makeEventVendorEvent('strict-capacity', {
			event_vendor_needs: [
				{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
				{ vendor_type: 'SERVICE', quantity: 1, fee: 15 },
			],
		}));
		state.applications.push(makeApplicationDocument({
			application_id: 'full-merch', event_id: 'strict-capacity', vendor_user_id: 'awarded-vendor',
			profile_id: 'profile-awarded-vendor', status: 'AWARDED', vendor_types: ['MERCHANDISE'],
		}, state));
		let controller = loadEventVendorController(state);
		let result = await runController(controller.submitApplication, eventVendorRequest('dual-profile', 'strict-capacity', {
			body: validEventVendorBody(['MERCHANDISE']),
		}));
		assert.equal(result.error && result.error.code, 409);
		assert.match(result.error.message, /All requested Marketplace Vendor capacity/);
		assertEventVendorSubmissionUntouched(state);

		controller = loadEventVendorController(state);
		result = await runController(controller.submitApplication, eventVendorRequest('dual-profile', 'strict-capacity', {
			body: validEventVendorBody(['MERCHANDISE', 'SERVICE']),
		}));
		assert.equal(result.error && result.error.code, 409);
		assertEventVendorSubmissionUntouched(state);

		controller = loadEventVendorController(state);
		result = await runController(controller.submitApplication, eventVendorRequest('dual-profile', 'strict-capacity', {
			body: validEventVendorBody(['SERVICE']),
		}));
		assert.equal(result.error, undefined);
		assert.equal(state.counters.eventVendorCreates, 1);
		assert.deepStrictEqual(result.response.payload.eventVendorApplication.vendor_types, ['SERVICE']);
	}

	for (const blockedRequest of [
		{
			name: 'profile-unapproved type',
			profileTypes: ['MERCHANDISE'],
			needs: [
				{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
				{ vendor_type: 'SERVICE', quantity: 1, fee: 15 },
			],
			requestedTypes: ['SERVICE'],
		},
		{
			name: 'event-unrequested type',
			profileTypes: ['MERCHANDISE', 'OTHER'],
			needs: [{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 }],
			requestedTypes: ['OTHER'],
		},
	]) {
		const state = createEventVendorState();
		addEventVendor(state, 'unauthorized-type-vendor', blockedRequest.profileTypes);
		state.events.push(makeEventVendorEvent('unauthorized-type-event', {
			event_vendor_needs: blockedRequest.needs,
		}));
		const controller = loadEventVendorController(state);
		const result = await runController(controller.submitApplication, eventVendorRequest(
			'unauthorized-type-vendor',
			'unauthorized-type-event',
			{ body: validEventVendorBody(blockedRequest.requestedTypes) }
		));
		assert.equal(result.error && result.error.code, 409, blockedRequest.name);
		assert.match(result.error.message, /All requested Marketplace Vendor capacity/);
		assertEventVendorSubmissionUntouched(state);
	}

	{
		const state = createEventVendorState();
		addEventVendor(state, 'editing-vendor', ['MERCHANDISE', 'SERVICE']);
		state.events.push(makeEventVendorEvent('edit-full', {
			event_vendor_needs: [
				{ vendor_type: 'MERCHANDISE', quantity: 1, fee: 25 },
				{ vendor_type: 'SERVICE', quantity: 1, fee: 15 },
			],
		}));
		const existing = makeApplicationDocument({
			application_id: 'existing-edit', event_id: 'edit-full', vendor_user_id: 'editing-vendor',
			profile_id: 'profile-editing-vendor', status: 'SUBMITTED', vendor_types: ['MERCHANDISE'],
			additional_notes: 'unchanged', participation_path: 'APPLICATION',
		}, state);
		state.applications.push(existing, makeApplicationDocument({
			application_id: 'filled-edit-merch', event_id: 'edit-full', vendor_user_id: 'winner',
			profile_id: 'profile-winner', status: 'AWARDED', vendor_types: ['MERCHANDISE'],
		}, state));
		const controller = loadEventVendorController(state);
		const result = await runController(controller.submitApplication, eventVendorRequest('editing-vendor', 'edit-full', {
			body: { ...validEventVendorBody(['MERCHANDISE']), additional_notes: 'must not be applied' },
		}));
		assert.equal(result.error && result.error.code, 409);
		assert.equal(existing.additional_notes, 'unchanged');
		assertEventVendorSubmissionUntouched(state);
	}

	for (const eventOverride of [
		{ status: 'CLOSED' },
		{ status: 'CANCELLED' },
		{ event_close_date: pastDate() },
		{ vendor_applications_closed_at: new Date() },
	]) {
		const state = createEventVendorState();
		addEventVendor(state, 'blocked-vendor', ['MERCHANDISE']);
		state.events.push(makeEventVendorEvent('blocked-event', eventOverride));
		const controller = loadEventVendorController(state);
		const result = await runController(controller.submitApplication, eventVendorRequest('blocked-vendor', 'blocked-event', {
			body: validEventVendorBody(['MERCHANDISE']),
		}));
		assert.equal(result.error && result.error.code, 410);
		assertEventVendorSubmissionUntouched(state);
	}
};

(async () => {
	await runFoodVendorTests();
	await runMarketplaceVendorTests();
	console.log('marketplace event visibility controller execution tests passed');
})().catch((error) => {
	Module._load = originalLoad;
	console.error(error);
	process.exitCode = 1;
});
