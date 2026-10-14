const { docusign } = require('../../config');
const fs = require('fs');
const { addObjectFromBufferWithKey, addObjectWithKey } = require('../../helper/aws');
const EncryptionService = require('../../helper/encryption');
const DocuSignHelper = require('../../helper/docusign-helper');
const {
  CoordinatorComplianceW9EnvelopeModel,
  CoordinatorComplianceProfileModel,
  UserModel,
} = require('../../models');

const buildError = (message, code = 400) => Object.assign(new Error(message), { code });

const getCoordinator = async (user) => {
  const coordinator = await UserModel.findById(user._id);
  if (!coordinator || user.userType !== 'CUSTOMER' || !coordinator.isEventCoordinator) {
    throw buildError('Only enabled event coordinators can manage coordinator compliance.', 403);
  }
  return coordinator;
};

const requiresPayoutCompliance = (coordinator) =>
  coordinator.eventCoordinatorExpectsTicketSales === true ||
  coordinator.eventCoordinatorExpectsVendorFees === true;

const maskTaxId = (value, type) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return null;
  return `${type}:${'*'.repeat(5)}${digits.slice(-4)}`;
};

const toSafeProfile = (profile) => {
  if (!profile) return null;
  const value = typeof profile.toObject === 'function' ? profile.toObject() : profile;
  return {
    party_type: value.party_type,
    legal_name: value.legal_name,
    dba_name: value.dba_name,
    entity_type: value.entity_type,
    registration_state: value.registration_state,
    business_address: value.business_address,
    tax_id_type: value.tax_id_type,
    tax_id_masked: value.tax_id_masked,
    documents: (value.documents || []).map((document) => ({
      document_type: document.document_type,
      original_name: document.original_name,
      uploaded_at: document.uploaded_at,
    })),
  };
};

const buildComplianceSummary = ({ profile, session, requiresPayout }) => {
  const requiredDocumentType = profile?.party_type === 'BUSINESS'
    ? 'BUSINESS_LICENSE'
    : 'DRIVER_LICENSE_FRONT';
  const hasRequiredDocument = (profile?.documents || []).some(
    (document) => document.document_type === requiredDocumentType
  );
  const hasProfile = Boolean(profile?.party_type && profile?.legal_name);
  const hasBusinessFields = profile?.party_type !== 'BUSINESS' || Boolean(
    profile?.business_address && profile?.registration_state && profile?.entity_type
  );
  const requirements = [
    { key: 'PROFILE', label: 'Compliance profile', complete: hasProfile && hasBusinessFields },
    { key: requiredDocumentType, label: profile?.party_type === 'BUSINESS' ? 'Business license' : 'Driver license front', complete: hasRequiredDocument },
  ];
  if (requiresPayout) {
    requirements.push(
      { key: 'TAX_ID', label: 'EIN or SSN', complete: Boolean(profile?.tax_id_encrypted) },
      { key: 'W9', label: 'Signed W-9', complete: session?.status === 'SIGNED' },
      // A signed document is not provider verification. Keep this visible in
      // the score until the Cobalt/ComplyCube result is recorded.
      { key: 'IDENTITY_VERIFICATION', label: 'Identity verification', complete: false }
    );
  }
  const completed = requirements.filter((item) => item.complete).length;
  const score = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;
  return {
    score,
    score_color: score === 100 ? 'green' : score >= 50 ? 'yellow' : 'orange',
    score_label: score === 100 ? 'Compliance complete' : 'Needs attention',
    requirements,
    remaining: requirements.filter((item) => !item.complete).map((item) => item.label),
    provider_verification_pending: requiresPayout && coordinatorVerificationPending(profile, session),
  };
};

const coordinatorVerificationPending = (profile, session) => Boolean(
  profile?.tax_id_encrypted && session?.status === 'SIGNED'
);

const getOrMigrateProfile = async (coordinator) => {
  let profile = await CoordinatorComplianceProfileModel.findOne({ coordinator_user_id: coordinator._id });
  if (profile) return profile;
  const hasLegacyIdentity = coordinator.eventCoordinatorCompanyName || coordinator.eventCoordinatorTaxIdEncrypted;
  if (!hasLegacyIdentity) return null;
  profile = await CoordinatorComplianceProfileModel.create({
    coordinator_user_id: coordinator._id,
    party_type: coordinator.eventCoordinatorCompanyName ? 'BUSINESS' : 'INDIVIDUAL',
    legal_name: coordinator.eventCoordinatorCompanyName || [coordinator.firstName, coordinator.lastName].filter(Boolean).join(' '),
    business_address: coordinator.eventCoordinatorCompanyAddress || coordinator.eventCoordinatorFormattedAddress || null,
    registration_state: coordinator.eventCoordinatorAddressState || null,
    tax_id_type: coordinator.eventCoordinatorTaxIdType || null,
    tax_id_encrypted: coordinator.eventCoordinatorTaxIdEncrypted || null,
    tax_id_masked: coordinator.eventCoordinatorTaxIdMasked || null,
  });
  // Move, rather than duplicate, the previous profile-only coordinator data.
  Object.assign(coordinator, {
    eventCoordinatorCompanyName: null,
    eventCoordinatorCompanyAddress: null,
    eventCoordinatorTaxIdType: null,
    eventCoordinatorTaxIdEncrypted: null,
    eventCoordinatorTaxIdMasked: null,
    eventCoordinatorEin: null,
  });
  await coordinator.save();
  return profile;
};

const toSafeSession = (session) => {
  if (!session) return null;
  const value = typeof session.toObject === 'function' ? session.toObject() : session;
  return {
    session_id: value.session_id,
    envelope_id: value.envelope_id,
    status: value.status,
    verification_status: value.verification_status,
    completed_at: value.completed_at,
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
};

exports.status = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const session = await CoordinatorComplianceW9EnvelopeModel.findOne({
      coordinator_user_id: coordinator._id,
    }).sort({ created_at: -1 });
    const profile = await getOrMigrateProfile(coordinator);
    const requiresPayout = requiresPayoutCompliance(coordinator);
    return res.data({
      payout_eligibility: coordinator.eventCoordinatorPayoutEligibility,
      requires_payout_compliance: requiresPayout,
      w9_session: toSafeSession(session),
      profile: toSafeProfile(profile),
      compliance: buildComplianceSummary({ profile, session, requiresPayout }),
    }, 'Coordinator compliance status');
  } catch (error) {
    return next(error);
  }
};

exports.saveProfile = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const partyType = String(req.body?.party_type || '').toUpperCase();
    if (!['INDIVIDUAL', 'BUSINESS'].includes(partyType)) {
      throw buildError('Choose whether the coordinator is an individual or business.');
    }
    const legalName = String(req.body?.legal_name || '').trim();
    if (!legalName) throw buildError('Legal name is required.');
    if (partyType === 'BUSINESS' && !String(req.body?.business_address || '').trim()) {
      throw buildError('Business address is required.');
    }
    const profile = await CoordinatorComplianceProfileModel.findOneAndUpdate(
      { coordinator_user_id: coordinator._id },
      {
        $set: {
          party_type: partyType,
          legal_name: legalName,
          dba_name: partyType === 'BUSINESS' ? String(req.body?.dba_name || '').trim() || null : null,
          entity_type: partyType === 'BUSINESS' ? String(req.body?.entity_type || '').toUpperCase() || null : null,
          registration_state: partyType === 'BUSINESS' ? String(req.body?.registration_state || '').toUpperCase() || null : null,
          business_address: partyType === 'BUSINESS' ? String(req.body?.business_address || '').trim() : null,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const taxId = String(req.body?.tax_id || '').replace(/\D/g, '');
    const taxIdType = String(req.body?.tax_id_type || '').toUpperCase();
    if (taxId || taxIdType) {
      if (!['EIN', 'SSN'].includes(taxIdType) || taxId.length !== 9) {
        throw buildError('A nine-digit EIN or SSN is required.');
      }
      // The encrypted value remains in the compliance record only. Provider
      // selection is intentionally deferred to the verification service.
      profile.tax_id_type = taxIdType;
      profile.tax_id_encrypted = EncryptionService.encrypt(taxId);
      profile.tax_id_masked = maskTaxId(taxId, taxIdType);
      await profile.save();
    }
    return res.data({ profile: toSafeProfile(profile) }, 'Coordinator compliance profile saved');
  } catch (error) {
    return next(error);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    if (!req.file) throw buildError('Choose a document to upload.');
    const documentType = String(req.body?.document_type || '').toUpperCase();
    if (!['DRIVER_LICENSE_FRONT', 'BUSINESS_LICENSE'].includes(documentType)) {
      throw buildError('Unsupported coordinator compliance document.');
    }
    const profile = await getOrMigrateProfile(coordinator);
    if (!profile) throw buildError('Save the coordinator compliance profile before uploading documents.', 409);
    if (profile.party_type === 'INDIVIDUAL' && documentType !== 'DRIVER_LICENSE_FRONT') {
      throw buildError('Individuals only need the front of a driver license.');
    }
    if (profile.party_type === 'BUSINESS' && documentType !== 'BUSINESS_LICENSE') {
      throw buildError('Businesses must upload a business license.');
    }
    const { url, key } = await addObjectWithKey(req.file, `coordinator-compliance/${coordinator._id}/${documentType}`);
    profile.documents = (profile.documents || []).filter((item) => item.document_type !== documentType);
    profile.documents.push({ document_type: documentType, file_url: url, file_key: key, original_name: req.file.originalname, mime_type: req.file.mimetype });
    await profile.save();
    fs.unlink(req.file.path, () => {});
    return res.data({ profile: toSafeProfile(profile) }, 'Coordinator compliance document uploaded');
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(error);
  }
};

exports.startW9Signing = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    if (!requiresPayoutCompliance(coordinator)) {
      throw buildError('Enable ticket sales or vendor-fee payouts before signing a W-9.', 409);
    }
    const profile = await getOrMigrateProfile(coordinator);
    if (!profile?.tax_id_encrypted || !profile?.tax_id_masked) {
      throw buildError('Add your EIN or SSN in Coordinator Compliance before signing a W-9.', 409);
    }

    const signerName = [coordinator.firstName, coordinator.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || profile.legal_name || 'Event Coordinator';
    const envelope = await DocuSignHelper.createVendorComplianceW9Envelope({
      vendorName: signerName,
      vendorEmail: coordinator.email,
      vendorUserId: coordinator._id,
    });
    const envelopeId = String(envelope?.envelopeId || envelope?.envelope_id || '').trim();
    if (!envelopeId) throw new Error('DocuSign did not create a W-9 signing session.');

    const recipients = await DocuSignHelper.getEnvelopeRecipients(envelopeId);
    const signer = (recipients?.signers || []).find(
      (item) => String(item?.clientUserId || '') === String(coordinator._id)
    );
    if (!signer?.recipientId) throw new Error('DocuSign did not return the W-9 signer.');
    const view = await DocuSignHelper.createRecipientView({
      envelopeId,
      signerName,
      signerEmail: coordinator.email,
      vendorUserId: coordinator._id,
      recipientId: signer.recipientId,
      returnUrl: docusign.customerReturnUrl,
    });
    const session = await CoordinatorComplianceW9EnvelopeModel.create({
      coordinator_user_id: coordinator._id,
      envelope_id: envelopeId,
      verification_status: 'PENDING',
    });
    return res.data({
      envelope_id: envelopeId,
      signing_url: view?.url,
      w9_session: toSafeSession(session),
    }, 'Coordinator W-9 signing started');
  } catch (error) {
    return next(error);
  }
};

exports.completeW9Signing = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const envelopeId = String(req.body?.envelope_id || '').trim();
    if (!envelopeId) throw buildError('W-9 signing session is required.');
    const session = await CoordinatorComplianceW9EnvelopeModel.findOne({
      coordinator_user_id: coordinator._id,
      envelope_id: envelopeId,
    });
    if (!session) throw buildError('Coordinator W-9 signing session not found.', 404);
    if (session.signed_document_key) {
      return res.data({ w9_session: toSafeSession(session), pending_verification: true }, 'W-9 is already awaiting verification');
    }

    const envelope = await DocuSignHelper.getEnvelopeStatus(envelopeId);
    const status = String(envelope?.status || '').toLowerCase();
    if (status !== 'completed') {
      session.status = status === 'declined' ? 'DECLINED' : status === 'voided' ? 'VOIDED' : 'SENT';
      await session.save();
      throw buildError('DocuSign has not confirmed the completed W-9 signature.', 409);
    }

    const pdfBuffer = await DocuSignHelper.downloadEnvelopeDocuments(envelopeId);
    const { url, key } = await addObjectFromBufferWithKey(
      {
        buffer: pdfBuffer,
        originalname: `signed-coordinator-w9-${envelopeId}.pdf`,
        mimetype: 'application/pdf',
      },
      `coordinator-compliance/${coordinator._id}/W9`
    );
    session.status = 'SIGNED';
    session.signed_document_url = url;
    session.signed_document_key = key;
    session.verification_status = 'PENDING';
    session.completed_at = new Date();
    session.error_message = null;
    await session.save();

    return res.data({ w9_session: toSafeSession(session), pending_verification: true }, 'Signed coordinator W-9 received and awaiting verification');
  } catch (error) {
    return next(error);
  }
};
