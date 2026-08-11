const assert = require('assert');
const {
	COORDINATOR_DETAILS_EMAIL_CLAIM_TIMEOUT_MS,
	deliverCoordinatorDetailsEmail,
	getClaimableCoordinatorDetailsEmailQuery,
} = require('./marketplace-coordinator-details-email');

const fixedNow = new Date('2026-08-11T12:00:00.000Z');

const createModel = ({ application, claim = true } = {}) => {
	const calls = { claims: [], updates: [] };
	return {
		calls,
		async findOneAndUpdate(query, update) {
			calls.claims.push({ query, update });
			return claim ? application : null;
		},
		async updateOne(query, update) {
			calls.updates.push({ query, update });
			return { modifiedCount: 1 };
		},
	};
};

const application = {
	application_id: 'application-1',
	vendor_user_id: 'vendor-1',
	status: 'PAID',
};

const execute = async ({ model, overrides = {} }) => deliverCoordinatorDetailsEmail({
	applicationModel: model,
	applicationId: 'application-1',
	eventId: 'event-1',
	loadEvent: async () => ({ event_id: 'event-1', event_name: 'Market Day', customer_user_id: 'coordinator-1' }),
	loadVendor: async () => ({ _id: 'vendor-1', name: 'Vendor' }),
	loadCoordinator: async () => ({ _id: 'coordinator-1', email: 'coordinator@example.com' }),
	sendMail: async () => undefined,
	buildHtml: () => '<p>unlocked details</p>',
	now: () => fixedNow,
	createClaimToken: () => 'claim-token-1',
	log: { error: () => undefined },
	...overrides,
});

(async () => {
	// Legacy applications with no email-state fields are claimed and delivered.
	{
		const model = createModel({ application });
		const sent = [];
		const result = await execute({
			model,
			overrides: {
				sendMail: async (...args) => sent.push(args),
				buildHtml: ({ application: deliveredApplication, vendor }) =>
					`<p>${deliveredApplication.application_id}:${vendor.name}:unlocked details</p>`,
			},
		});
		assert.deepStrictEqual(result, { claimed: true, delivered: true });
		assert.deepStrictEqual(sent, [[
			'coordinator@example.com',
			'RTC Marketplace Vendor payment completed - Market Day',
			'<p>application-1:Vendor:unlocked details</p>',
		]]);
		assert.strictEqual(model.calls.claims[0].update.$set.coordinator_details_email_claim_token, 'claim-token-1');
		assert.strictEqual(model.calls.updates[0].update.$set.coordinator_details_email_status, 'SENT');
		assert.strictEqual(model.calls.updates[0].query.coordinator_details_email_claim_token, 'claim-token-1');
	}

	// A missing coordinator address is never called a successful delivery.
	{
		const model = createModel({ application });
		const result = await execute({ model, overrides: { loadCoordinator: async () => ({ _id: 'coordinator-1' }) } });
		assert.strictEqual(result.delivered, false);
		assert.strictEqual(model.calls.updates[0].update.$set.coordinator_details_email_status, 'RETRYABLE');
		assert.match(model.calls.updates[0].update.$set.coordinator_details_email_last_error, /email is unavailable/);
	}

	// Lookup failures are contained and leave the paid application retryable.
	{
		const model = createModel({ application });
		const result = await execute({ model, overrides: { loadEvent: async () => { throw new Error('database unavailable'); } } });
		assert.strictEqual(result.retryable, true);
		assert.strictEqual(model.calls.updates[0].update.$set.coordinator_details_email_status, 'RETRYABLE');
		assert.match(model.calls.updates[0].update.$set.coordinator_details_email_last_error, /database unavailable/);
	}

	// Mail failure leaves the payment paid and allows a later callback to retry.
	{
		const model = createModel({ application });
		const result = await execute({ model, overrides: { sendMail: async () => { throw new Error('mail unavailable'); } } });
		assert.strictEqual(result.delivered, false);
		assert.strictEqual(model.calls.updates[0].update.$set.coordinator_details_email_status, 'RETRYABLE');
	}

	// A claim-store failure is nonfatal; the paid payment can retry on a later callback.
	{
		const model = createModel({ application });
		model.findOneAndUpdate = async () => { throw new Error('claim store unavailable'); };
		const result = await execute({ model });
		assert.deepStrictEqual(result, { claimed: false, delivered: false, retryable: true });
		assert.strictEqual(model.calls.updates.length, 0);
	}

	// SENDING applications become claimable only after the bounded stale-claim window.
	{
		const query = getClaimableCoordinatorDetailsEmailQuery({ applicationId: 'application-1', now: fixedNow });
		const staleEntry = query.$or.find((entry) => entry.coordinator_details_email_claimed_at?.$lte);
		assert.ok(staleEntry);
		assert.strictEqual(
			staleEntry.coordinator_details_email_claimed_at.$lte.getTime(),
			fixedNow.getTime() - COORDINATOR_DETAILS_EMAIL_CLAIM_TIMEOUT_MS
		);
		assert.ok(query.$or.some((entry) => entry.coordinator_details_email_status?.$exists === false));
	}

	// A second worker which did not acquire the token cannot finalize the first worker's claim.
	{
		const model = createModel({ application, claim: false });
		let sentCount = 0;
		const result = await execute({
			model,
			overrides: { sendMail: async () => { sentCount += 1; } },
		});
		assert.deepStrictEqual(result, { claimed: false, delivered: false });
		assert.strictEqual(model.calls.updates.length, 0);
		assert.strictEqual(sentCount, 0, 'a SENT/non-claimable application never resends coordinator details');
	}

	console.log('marketplace coordinator details email tests passed');
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
