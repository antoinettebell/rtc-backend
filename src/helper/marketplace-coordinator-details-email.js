const { v4: uuidv4 } = require('uuid');

const COORDINATOR_DETAILS_EMAIL_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

const getClaimableCoordinatorDetailsEmailQuery = ({ applicationId, now = new Date() }) => ({
	application_id: applicationId,
	status: 'PAID',
	$or: [
		{ coordinator_details_email_status: { $exists: false } },
		{ coordinator_details_email_status: null },
		{ coordinator_details_email_status: { $in: ['PENDING', 'RETRYABLE'] } },
		{
			coordinator_details_email_status: 'SENDING',
			coordinator_details_email_claimed_at: { $exists: false },
		},
		{
			coordinator_details_email_status: 'SENDING',
			coordinator_details_email_claimed_at: null,
		},
		{
			coordinator_details_email_status: 'SENDING',
			coordinator_details_email_claimed_at: {
				$lte: new Date(now.getTime() - COORDINATOR_DETAILS_EMAIL_CLAIM_TIMEOUT_MS),
			},
		},
	],
});

const getClaimUpdate = ({ token, now = new Date() }) => ({
	$set: {
		coordinator_details_email_status: 'SENDING',
		coordinator_details_email_claimed_at: now,
		coordinator_details_email_claim_token: token,
		coordinator_details_email_last_error: null,
	},
});

const getOwnedClaimQuery = ({ applicationId, token }) => ({
	application_id: applicationId,
	status: 'PAID',
	coordinator_details_email_status: 'SENDING',
	coordinator_details_email_claim_token: token,
});

const controlledDeliveryError = (message) => {
	const error = new Error(message);
	error.isCoordinatorDetailsDeliveryError = true;
	return error;
};

const getDeliveryDiagnostic = (error) => String(
	error?.message || 'Coordinator details email delivery failed'
).replace(/[\r\n]+/g, ' ').trim().slice(0, 500);

const deliverCoordinatorDetailsEmail = async ({
	applicationModel,
	applicationId,
	eventId,
	loadEvent,
	loadVendor,
	loadCoordinator,
	sendMail,
	buildHtml,
	now = () => new Date(),
	createClaimToken = uuidv4,
	log = console,
}) => {
	const claimedAt = now();
	const token = createClaimToken();
	let application;
	try {
		application = await applicationModel.findOneAndUpdate(
			getClaimableCoordinatorDetailsEmailQuery({ applicationId, now: claimedAt }),
			getClaimUpdate({ token, now: claimedAt }),
			{ new: true }
		);
	} catch (error) {
		// A claim-store outage must never turn an already-confirmed payment into an error.
		log.error?.('Marketplace Vendor unlocked-details email claim failed', {
			applicationId,
			message: getDeliveryDiagnostic(error),
		});
		return { claimed: false, delivered: false, retryable: true };
	}

	if (!application) {
		return { claimed: false, delivered: false };
	}

	const ownedClaim = getOwnedClaimQuery({ applicationId, token });
	try {
		const event = await loadEvent(eventId);
		if (!event) throw controlledDeliveryError('Coordinator details email retryable: event is unavailable');

		const vendor = await loadVendor(application.vendor_user_id);
		if (!vendor) throw controlledDeliveryError('Coordinator details email retryable: vendor is unavailable');

		const coordinator = event.customer_user_id
			? await loadCoordinator(event.customer_user_id)
			: null;
		if (!coordinator?.email) {
			throw controlledDeliveryError('Coordinator details email retryable: coordinator email is unavailable');
		}

		await sendMail(
			coordinator.email,
			`RTC Marketplace Vendor payment completed - ${event.event_name || event.event_id}`,
			buildHtml({ application, vendor })
		);

		const sentAt = now();
		await applicationModel.updateOne(ownedClaim, {
			$set: {
				coordinator_details_email_status: 'SENT',
				coordinator_details_email_sent_at: sentAt,
				coordinator_details_email_last_error: null,
			},
			$unset: {
				coordinator_details_email_claimed_at: 1,
				coordinator_details_email_claim_token: 1,
			},
		});
		return { claimed: true, delivered: true };
	} catch (error) {
		// The payment is already final. Email delivery is a durable retryable side effect.
		await applicationModel.updateOne(ownedClaim, {
			$set: {
				coordinator_details_email_status: 'RETRYABLE',
				coordinator_details_email_last_error: getDeliveryDiagnostic(error),
			},
			$unset: {
				coordinator_details_email_claimed_at: 1,
				coordinator_details_email_claim_token: 1,
			},
		});
		log.error?.('Marketplace Vendor unlocked-details email failed', {
			applicationId,
			message: getDeliveryDiagnostic(error),
		});
		return { claimed: true, delivered: false, retryable: true };
	}
};

module.exports = {
	COORDINATOR_DETAILS_EMAIL_CLAIM_TIMEOUT_MS,
	getClaimableCoordinatorDetailsEmailQuery,
	getClaimUpdate,
	getOwnedClaimQuery,
	deliverCoordinatorDetailsEmail,
};
