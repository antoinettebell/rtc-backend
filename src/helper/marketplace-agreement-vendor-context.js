const resolveMarketplaceAgreementVendorContext = async ({
  user,
  findApprovedEventVendorProfile,
  findFoodTruck,
}) => {
  if (user?.vendorSubtype === 'EVENT_VENDOR') {
    const profile = await findApprovedEventVendorProfile(user._id);
    if (!profile) {
      const error = new Error('An approved Marketplace Vendor profile is required');
      error.status = 403;
      error.code = 403;
      throw error;
    }
    return { foodTruck: null, eventVendorProfile: profile };
  }
  return { foodTruck: await findFoodTruck(user._id), eventVendorProfile: null };
};

const buildSignedAgreementAttachmentContext = ({
  agreement,
  eventId,
  bidId = null,
  applicationId = null,
  vendorUserId,
  foodTruck = null,
  reuseExistingSignedDocument = false,
}) => ({
  status: 'SIGNED',
  envelope_id: agreement.envelope_id,
  event_id: eventId,
  bid_id: bidId,
  application_id: applicationId,
  vendor_user_id: vendorUserId,
  food_truck_id: foodTruck?._id || null,
  reuse_existing_signed_document: reuseExistingSignedDocument,
});

const buildSignedAgreementAttachmentLink = ({
  eventId,
  vendorUserId,
  envelopeId,
  applicationId,
}) => ({
  query: {
    event_id: eventId,
    uploaded_by_user_id: vendorUserId,
    docusign_envelope_id: envelopeId,
    attachment_type: 'AGREEMENT_DOCUMENT',
    application_id: null,
  },
  update: { application_id: applicationId },
});

const buildActiveAgreementIdentityKey = ({
  vendorUserId,
  eventVendorProfileId = null,
  eventId,
  agreementType,
}) => [vendorUserId, eventVendorProfileId || 'food-vendor', eventId, agreementType]
  .map((value) => String(value || '').trim())
  .join(':');

const reserveActiveMarketplaceAgreement = async ({ create, find, identityKey, payload }) => {
  try {
    return { agreement: await create({ ...payload, active_identity_key: identityKey }), created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const agreement = await find(identityKey);
    if (!agreement) throw error;
    return { agreement, created: false };
  }
};

module.exports = {
  buildSignedAgreementAttachmentContext,
  buildSignedAgreementAttachmentLink,
  buildActiveAgreementIdentityKey,
  reserveActiveMarketplaceAgreement,
  resolveMarketplaceAgreementVendorContext,
};
