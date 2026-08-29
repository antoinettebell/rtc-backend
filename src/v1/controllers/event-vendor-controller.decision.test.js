const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'event-vendor-controller.js');
const originalLoad = Module._load;
const actualLifecycle = require('../../helper/marketplace-submission-lifecycle');
const { hasMarketplaceVendorAwardCapacity } = require('../../helper/marketplace-event-visibility-helper');

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
			findOne: async () => state.payment || null,
			findOneAndUpdate: async (query, update) => {
				if (state.paymentRaceToPaid) {
					state.payment.payment_status = 'PAID';
					state.paymentRaceToPaid = false;
					return null;
				}
				if (!state.payment || state.payment.payment_status !== query.payment_status) return null;
				if (query.refund_status && state.payment.refund_status !== query.refund_status) return null;
				if (query.refund_processed_by_user_id && String(state.payment.refund_processed_by_user_id) !== String(query.refund_processed_by_user_id)) return null;
				if (query.$or && !['NOT_REQUESTED', 'FAILED', undefined].includes(state.payment.refund_status)) return null;
				Object.assign(state.payment, update.$set || {});
				counters.paymentSaves += 1;
				return state.payment;
			},
			create: async (payload) => {
				counters.paymentCreates += 1;
				state.createdPayment = payload;
				return { payment_id: 'payment-1', ...payload };
			},
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
			if (request === '../../helper/cybersource-refund-helper') return {
				processRefund: async () => {
					counters.refunds += 1;
					return state.refundSuccess
						? { success: true, refundTransactionId: 'refund-1', mode: 'refund' }
						: { success: false, message: 'Gateway declined refund' };
				},
			};
			if (request === '../../helper/marketplace-communications-helper') return {
				sendMarketplaceCommunication: async ({ userId, channels, emailSubject, emailBody }) => {
					counters.notifications += 1;
					counters.notificationUserIds.push(String(userId));
					if (channels?.includes('email')) {
						counters.emails += 1;
						counters.emailArgs.push([userId, emailSubject, emailBody]);
					}
				},
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
	const counters = { saves: 0, paymentCreates: 0, paymentSaves: 0, refunds: 0, emails: 0, emailArgs: [], notifications: 0, notificationUserIds: [] };
	const application = {
		application_id: 'application-1', event_id: 'event-1', vendor_user_id: 'vendor-1', vendor_types: ['MERCHANDISE'],
		checkout_subtotal: 100, status: applicationStatus,
		save: async () => { counters.saves += 1; },
	};
	const event = {
		event_id: 'event-1', customer_user_id: 'coordinator-1', status: eventStatus,
		vendor_applications_closed_at: closedAt, event_close_date: closeDate,
		event_date: '2030-09-10T00:00:00.000Z', event_time: '4:00 PM',
		event_duration_hours: 4, event_timezone: 'America/New_York',
		event_vendor_needs: [{ vendor_type: 'MERCHANDISE', quantity: 1 }],
	};
	return { counters, application, event, coordinator: null, payment: null, paymentRaceToPaid: false, refundSuccess: true };
};

(async () => {
	for (const blocked of [
		{ eventStatus: 'CANCELLED' },
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

	for (const closed of [
		{ eventStatus: 'CLOSED' },
		{ closedAt: new Date() },
		{ closeDate: new Date('2020-01-01') },
	]) {
		const state = createState(closed);
		const controller = loadController(state);
		const result = await run(controller.awardApplication);
		assert.equal(result.error, undefined, 'existing Marketplace Vendor applications remain awardable after bidding closes');
		assert.equal(state.application.status, 'PAYMENT_DUE');
	}

	{
		const state = createState();
		state.coordinator = { email: 'coordinator@example.com' };
		const controller = loadController(state);
		const result = await run(controller.awardApplication);
		assert.equal(result.error, undefined);
		assert.equal(state.application.status, 'PAYMENT_DUE');
		assert.equal(state.counters.paymentCreates, 1);
		assert.equal(state.createdPayment.fee_amount, 0.01);
		assert.equal(state.createdPayment.total_amount, 100.01);
		assert.equal(state.createdPayment.fee_rate, 3.5);
		assert.equal(state.counters.saves, 1);
		assert.equal(state.counters.emails, 1);
		assert.match(state.counters.emailArgs[0][2], /recorded successfully/);
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
		assert.deepEqual(state.counters.notificationUserIds, ['vendor-1']);
	}

	{
		const state = createState({ eventStatus: 'AWARDED' });
		const controller = loadController(state);
		const result = await run(controller.declineApplication);
		assert.equal(result.error, undefined, 'a pending Marketplace Vendor application remains rejectable after another award');
		assert.equal(state.application.status, 'NOT_SELECTED');
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

	{
		const state = createState({ applicationStatus: 'PAYMENT_DUE' });
		state.application.payment_id = 'payment-1';
		state.payment = {
			payment_id: 'payment-1', payment_status: 'PENDING',
			processor_transaction_id: 'transaction-1', total_amount: 25,
			refund_status: 'NOT_REQUESTED',
			save: async () => { state.counters.paymentSaves += 1; },
		};
		const controller = loadController(state);
		const result = await run(controller.revokeApplicationAward);
		assert.equal(result.error?.code, 409);
		assert.match(result.error.message, /not yet a completed award/i);
		assert.equal(state.application.status, 'PAYMENT_DUE');
		assert.equal(state.payment.payment_status, 'PENDING');
		assert.equal(state.counters.saves, 0);
		assert.equal(state.counters.paymentSaves, 0);
		assert.equal(state.counters.notifications, 0);
		assert.deepEqual(state.counters.notificationUserIds, []);
		assert.equal(state.counters.paymentCreates, 0);
		assert.equal(hasMarketplaceVendorAwardCapacity({
			event: state.event,
			profileTypes: ['MERCHANDISE'],
			applications: [state.application],
		}), false, 'a pending selection continues reserving Marketplace Vendor capacity');
	}

	{
		const state = createState({ applicationStatus: 'PAID' });
		state.application.payment_id = 'payment-paid';
		state.payment = {
			payment_id: 'payment-paid', payment_status: 'PAID',
			payment_method: 'APPLE_PAY',
			processor_transaction_id: 'transaction-paid', total_amount: 25,
			refund_status: 'NOT_REQUESTED',
			save: async () => { state.counters.paymentSaves += 1; },
		};
		const controller = loadController(state);
		const result = await run(controller.revokeApplicationAward);
		assert.equal(result.error, undefined);
		assert.equal(state.counters.refunds, 1);
		assert.equal(state.application.status, 'NOT_SELECTED');
		assert.ok(state.application.award_revoked_at instanceof Date);
		assert.equal(state.payment.payment_status, 'REFUNDED');
		assert.equal(state.counters.notifications, 1);
	}

	{
		const state = createState({ applicationStatus: 'PAID' });
		state.application.payment_id = 'payment-failed';
		state.payment = {
			payment_id: 'payment-failed', payment_status: 'PAID',
			payment_method: 'APPLE_PAY',
			processor_transaction_id: 'transaction-failed', total_amount: 25,
			refund_status: 'NOT_REQUESTED',
		};
		state.refundSuccess = false;
		const controller = loadController(state);
		const result = await run(controller.revokeApplicationAward);
		assert.equal(result.error?.code, 502);
		assert.equal(state.application.status, 'PAID');
		assert.equal(state.payment.payment_status, 'PAID');
		assert.equal(state.payment.refund_status, 'FAILED');
		assert.equal(state.counters.saves, 0);
		assert.equal(state.counters.notifications, 0);
	}

	{
		const state = createState({ applicationStatus: 'PAYMENT_DUE' });
		state.application.payment_id = 'payment-race';
		state.payment = {
			payment_id: 'payment-race', payment_status: 'PENDING',
			processor_transaction_id: 'transaction-race', total_amount: 25,
			refund_status: 'NOT_REQUESTED',
		};
		state.paymentRaceToPaid = true;
		const controller = loadController(state);
		const result = await run(controller.revokeApplicationAward);
		assert.equal(result.error?.code, 409);
		assert.match(result.error.message, /not yet a completed award/i);
		assert.equal(state.counters.refunds, 0);
		assert.equal(state.application.status, 'PAYMENT_DUE');
		assert.equal(state.payment.payment_status, 'PENDING');
		assert.equal(state.counters.notifications, 0);
	}

	console.log('event vendor award and not-selected controller execution tests passed');
})().catch((error) => {
	Module._load = originalLoad;
	console.error(error);
	process.exitCode = 1;
});
