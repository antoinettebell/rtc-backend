const assert = require('assert');
const Module = require('module');
const path = require('path');

const controllerPath = path.join(__dirname, 'marketplace-controller.js');
const originalLoad = Module._load;

const loadController = ({ deliver }) => {
	const application = {
		application_id: 'application-1',
		vendor_user_id: 'vendor-1',
		status: 'PAYMENT_DUE',
		save: async () => undefined,
	};
	const payment = {
		payment_id: 'payment-1',
		application_id: 'application-1',
		payer_user_id: 'vendor-1',
		payer_type: 'VENDOR',
		payment_type: 'VENDOR_EVENT_FEE',
		payment_status: 'PAID',
		total_amount: 125,
	};
	const services = {
		FoodTruckService: {}, MarketplaceApplicationService: {}, MarketplaceAttachmentService: {},
		MarketplaceAgreementAuditService: {}, MarketplaceBidService: {}, MarketplaceEventImageService: {},
		MarketplaceEventQuestionService: {}, MarketplaceEventService: {}, MarketplaceFileAuditService: {},
		MarketplacePaymentAuditService: {}, MarketplaceVendorAgreementService: {}, UserService: {},
		VendorComplianceDocumentService: {},
		MarketplacePaymentService: {
			getByData: async () => payment,
			getModel: () => ({}),
		},
	};
	Module._load = (request, parent, isMain) => {
		if (parent?.filename === controllerPath) {
			if (request === '../services') return services;
			if (request === '../../helper/vendor-plan-helper') return { canUseCashPOS: () => true, canUseTapToPay: () => true };
			if (request === '../services/vendor-compliance-service' || request === '../services/operational-compliance-form-service') return {};
			if (request === '../../helper/aws') return {};
			if (request === '../../helper/cybersource-payment-helper' || request === '../../helper/docusign-helper') return {};
			if (request === '../../helper/marketplace-vendor-agreement-reconciliation') return {};
			if (request === '../../helper/marketplace-agreement-vendor-context') return {};
			if (request === '../../helper/marketplace-communications-helper' || request === '../../helper/mail-helper') return {};
			if (request === '../../helper/marketplace-award-email-helper') return { buildFoodVendorAwardDetailsHtml: () => '', buildEventVendorAwardDetailsHtml: () => '' };
			if (request === '../../helper/marketplace-coordinator-details-email') return { deliverCoordinatorDetailsEmail: deliver };
			if (request === '../../helper/marketplace-vendor-contact-helper' || request === '../../helper/marketplace-event-close-helper') return {};
			if (request === '../../helper/public-marketplace-event-helper' || request === '../../helper/marketplace-tax-exemption-helper') return {};
			if (request === '../../helper/marketplace-payment-policy-helper') return { isMarketplacePaymentMethodAllowed: () => true };
			if (request === '../../config') return { docusign: {} };
			if (request === '../../models') return { EventVendorApplicationModel: { findOne: async () => application } };
			if (request === '../../helper/marketplace-submission-lifecycle') return { ACTIVE_FOOD_BID_STATUSES: [], ACTIVE_FOOD_APPLICATION_STATUSES: [] };
			if (request === '../../helper/marketplace-content-moderation' || request === '../../helper/marketplace-message-context-helper' || request === '../../helper/marketplace-message-thread-helper' || request === '../../helper/marketplace-image-contact-moderation' || request === '../../helper/event-coordinator-profile' || request === '../../helper/marketplace-participation-helper') return {};
		}
		return originalLoad(request, parent, isMain);
	};
	delete require.cache[require.resolve(controllerPath)];
	const controller = require(controllerPath);
	Module._load = originalLoad;
	return { controller, payment };
};

const checkoutPaid = async ({ deliver }) => {
	const { controller } = loadController({ deliver });
	let response;
	let error;
	await controller.checkoutPayment(
		{ params: { paymentId: 'payment-1' }, user: { _id: 'vendor-1', userType: 'VENDOR' }, body: { payment_method: 'APPLE_PAY', expected_total: 125 } },
		{ data: (payload, message) => { response = { payload, message }; } },
		(nextError) => { error = nextError; }
	);
	return { response, error };
};

(async () => {
	let retryCalls = 0;
	const retried = await checkoutPaid({
		deliver: async () => { retryCalls += 1; return { claimed: true, delivered: true }; },
	});
	assert.equal(retryCalls, 1, 'an already-paid checkout retries unsent coordinator details');
	assert.equal(retried.error, undefined);
	assert.equal(retried.response.payload.routingResult.eventVendorApplication.status, 'PAID');

	let sentCalls = 0;
	const sent = await checkoutPaid({
		deliver: async () => { sentCalls += 1; return { claimed: false, delivered: false }; },
	});
	assert.equal(sentCalls, 1, 'the reconciliation checks the durable SENT claim without resending');
	assert.equal(sent.error, undefined);

	const originalConsoleError = console.error;
	const loggedErrors = [];
	console.error = (...args) => loggedErrors.push(args);
	let claimFailure;
	try {
		claimFailure = await checkoutPaid({
			deliver: async () => { throw new Error('claim storage unavailable'); },
		});
	} finally {
		console.error = originalConsoleError;
	}
	assert.equal(claimFailure.error, undefined, 'an email claim failure cannot fail an already-paid checkout response');
	assert.deepStrictEqual(claimFailure.response.payload.routingResult, { retryable_finalization_error: true });
	assert.equal(loggedErrors.length, 1, 'the nonfatal claim failure is logged for retry diagnostics');

	console.log('marketplace already-paid checkout controller tests passed');
})().catch((error) => {
	Module._load = originalLoad;
	console.error(error);
	process.exitCode = 1;
});
