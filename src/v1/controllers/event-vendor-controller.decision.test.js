const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'event-vendor-controller.js');
const originalLoad = Module._load;
const actualLifecycle = require('../../helper/marketplace-submission-lifecycle');

const loadController = (state) => {
	const counters = state.counters;
	const models = {
		EventVendorApplicationModel: {
			findOne: async () => state.application,
			countDocuments: async () => 0,
		},
		MarketplaceEventModel: {
			findOne: () => ({
				...state.event,
				lean: async () => state.event,
			}),
		},
		MarketplacePaymentModel: {
			findOne: async () => null,
			create: async () => { counters.paymentCreates += 1; return { payment_id: 'payment-1' }; },
		},
		UserModel: { findById: () => ({ lean: async () => state.coordinator || null }) },
		EventVendorProfileModel: {}, EventVendorPhotoModel: {}, MarketplaceVendorAgreementModel: {},
		MarketplaceAttachmentModel: {}, MarketplaceAgreementAuditModel: {}, MarketplaceEventImageModel: {},
		MarketplaceEventQuestionModel: {},
	};
	Module._load = (request, parent, isMain) => {
		if (parent?.filename === controllerPath) {
			if (request === '../../models') return models;
			if (request === '../../helper/aws') return { addObjectWithKey: async () => undefined };
			if (request === '../../config') return { docusign: {} };
			if (request === '../../helper/mail-helper') return {
				sendMail: async (...args) => { counters.emails += 1; counters.emailArgs.push(args); },
			};
			if (request === '../../helper/marketplace-communications-helper') return {
				sendMarketplaceCommunication: async () => { counters.notifications += 1; },
			};
			if (request === '../../helper/event-vendor-application-idempotency') return {};
			if (request === '../../helper/event-vendor-profile-lifecycle') return { MERCHANDISE_CATEGORIES: [] };
			if (request === '../../helper/event-vendor-photo-counter') return {};
			if (request === '../../helper/event-vendor-photo-cleanup') return {};
			if (request === '../../helper/marketplace-agreement-vendor-context') return {};
			if (request === '../../helper/marketplace-vendor-contact-helper') return {};
			if (request === '../../helper/marketplace-submission-lifecycle') return actualLifecycle;
			if (request === '../../helper/event-vendor-participation-helper') return {};
			if (request === '../../helper/external-web-link') return {};
		}
		return originalLoad(request, parent, isMain);
	};
	delete require.cache[require.resolve(controllerPath)];
	const controller = require(controllerPath);
	Module._load = originalLoad;
	return controller;
};

const run = async (handler, { params = { applicationId: 'application-1' } } = {}) => {
	let response;
	let capturedError;
	await handler(
		{ user: { _id: 'coordinator-1' }, params },
		{ data: (payload, message) => { response = { payload, message }; } },
		(error) => { capturedError = error; }
	);
	return { response, error: capturedError };
};

const createState = ({ eventStatus = 'OPEN', closedAt = null, closeDate = null, applicationStatus = 'SUBMITTED' } = {}) => {
	const counters = { saves: 0, paymentCreates: 0, emails: 0, emailArgs: [], notifications: 0 };
	const application = {
		application_id: 'application-1', event_id: 'event-1', vendor_user_id: 'vendor-1', vendor_types: ['MERCHANDISE'],
		checkout_subtotal: 100, status: applicationStatus,
		save: async () => { counters.saves += 1; },
	};
	const event = {
		event_id: 'event-1', customer_user_id: 'coordinator-1', status: eventStatus,
		vendor_applications_closed_at: closedAt, event_close_date: closeDate,
		event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 1 }],
	};
	return { counters, application, event, coordinator: null };
};

(async () => {
	for (const blocked of [
		{ eventStatus: 'CLOSED' },
		{ eventStatus: 'CANCELLED' },
		{ closedAt: new Date() },
		{ closeDate: new Date('2020-01-01') },
	]) {
		const state = createState(blocked);
		const controller = loadController(state);
		const result = await run(controller.awardApplication);
		assert.equal(result.error?.code, 409);
		assert.equal(state.counters.saves, 0);
		assert.equal(state.counters.paymentCreates, 0);
		assert.equal(state.counters.emails, 0);
		assert.equal(state.counters.notifications, 0);
	}

	{
		const state = createState();
		state.coordinator = { email: 'coordinator@example.com' };
		const controller = loadController(state);
		const result = await run(controller.awardApplication);
		assert.equal(result.error, undefined);
		assert.equal(state.application.status, 'PAYMENT_DUE');
		assert.equal(state.counters.paymentCreates, 1);
		assert.equal(state.counters.saves, 1);
		assert.equal(state.counters.emails, 1);
		assert.match(state.counters.emailArgs[0][2], /selection has been recorded/);
		assert.doesNotMatch(state.counters.emailArgs[0][2], /contact|phone|email|business/i);
	}

	for (const blocked of [
		{ eventStatus: 'CLOSED' },
		{ eventStatus: 'CANCELLED' },
		{ closedAt: new Date() },
		{ closeDate: new Date('2020-01-01') },
	]) {
		const state = createState(blocked);
		const controller = loadController(state);
		const result = await run(controller.declineApplication);
		assert.equal(result.error?.code, 409);
		assert.equal(state.counters.saves, 0);
		assert.equal(state.counters.notifications, 0);
	}

	{
		const state = createState();
		const controller = loadController(state);
		const result = await run(controller.declineApplication);
		assert.equal(result.error, undefined);
		assert.equal(state.application.status, 'NOT_SELECTED');
		assert.equal(state.counters.saves, 1);
		assert.equal(state.counters.notifications, 1);
	}

	{
		const state = createState({ eventStatus: 'CLOSED', applicationStatus: 'NOT_SELECTED' });
		const controller = loadController(state);
		const result = await run(controller.declineApplication);
		assert.equal(result.error, undefined);
		assert.match(result.response.message, /already not selected/);
		assert.equal(state.counters.saves, 0);
		assert.equal(state.counters.notifications, 0);
	}

	console.log('event vendor award and not-selected controller execution tests passed');
})().catch((error) => {
	Module._load = originalLoad;
	console.error(error);
	process.exitCode = 1;
});
