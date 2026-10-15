const { docusign } = require('../../config');
const fs = require('fs');
const { addObjectFromBufferWithKey, addObjectWithKey } = require('../../helper/aws');
const EncryptionService = require('../../helper/encryption');
const DocuSignHelper = require('../../helper/docusign-helper');
const { enqueueComplianceOcr } = require('../../helper/vendor-compliance-ocr-helper');
const {
  taxDigits,
  getTaxIdentifierOcrOutcome,
  getDocumentBusinessNames,
  getOcrMismatchOutcome,
  nameMatchesProfile,
} = require('../services/vendor-compliance-service');
const {
  CoordinatorComplianceW9EnvelopeModel,
  CoordinatorComplianceProfileModel,
  UserModel,
} = require('../../models');

const buildError = (message, code = 400) => Object.assign(new Error(message), { code });

const DRIVER_LICENSE_OCR_REQUIREMENT = { ocrFields: ['name'] };
const W9_OCR_REQUIREMENT = {
  ocrFields: ['ein', 'business_name', 'tax_classification', 'signature_date'],
};

const asVendorIdentity = (profile = {}) => ({
  legal_business_name: profile.legal_name || null,
  dba: profile.dba_name || null,
});

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
      document_id: document.document_id,
      document_type: document.document_type,
      original_name: document.original_name,
      uploaded_at: document.uploaded_at,
      ocr_status: document.ocr_status,
      ocr_error_message: document.ocr_error_message,
    })),
  };
};

const buildComplianceSummary = ({ profile, session, requiresPayout }) => {
  const requiredDocumentType = profile?.party_type === 'BUSINESS'
    ? 'BUSINESS_LICENSE'
    : 'DRIVER_LICENSE_FRONT';
  const hasRequiredDocument = (profile?.documents || []).some(
    (document) => document.document_type === requiredDocumentType && document.ocr_status === 'completed'
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
      { key: 'W9', label: 'Signed W-9', complete: session?.verification_status === 'PASSED' }
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
    // External Cobalt/ComplyCube verification is intentionally deferred until
    // the internal OCR comparison is proven. It must not lower this score.
    provider_verification_pending: false,
  };
};

const enqueueCoordinatorW9Ocr = async (session) => {
  const result = await enqueueComplianceOcr({
    document: {
      document_id: session.ocr_document_id,
      file_url: session.signed_document_url,
      file_key: session.signed_document_key,
      mime_type: 'application/pdf',
      document_type: 'W9',
    },
    requirement: W9_OCR_REQUIREMENT,
    callbackType: 'coordinator_compliance',
  });
  Object.assign(session, result);
  return session;
};

// Mirror the vendor lifecycle: normal Save & Run OCR submits new evidence
// only, but may recover a request that has remained queued for two minutes.
// This prevents duplicate active jobs while allowing a failed handoff to be
// retried from the one shared save action.
const shouldSubmitCoordinatorOcr = (record) => {
  if (!record) return false;
  if (record.ocr_status === 'not_configured') return true;
  if (record.ocr_status !== 'queued') return false;
  const requestedAt = record.ocr_requested_at
    ? new Date(record.ocr_requested_at).getTime()
    : 0;
  return !requestedAt || Date.now() - requestedAt >= 2 * 60 * 1000;
};

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
    ocr_status: value.ocr_status,
    ocr_error_message: value.ocr_error_message,
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
    profile.documents.push({
      document_type: documentType,
      file_url: url,
      file_key: key,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      ocr_status: 'not_configured',
    });
    await profile.save();
    fs.unlink(req.file.path, () => {});
    return res.data({ profile: toSafeProfile(profile) }, 'Coordinator compliance document uploaded');
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(error);
  }
};

// Only coordinator compliance documents use this route. It deliberately
// compares against the isolated compliance profile, never the customer user
// profile. Existing verified OCR is left untouched until the evidence changes.
exports.submitDocumentsForOcr = async (req, res, next) => {
  try {
    const coordinator = await getCoordinator(req.user);
    const profile = await getOrMigrateProfile(coordinator);
    if (!profile) throw buildError('Save coordinator compliance information before running OCR.', 409);
    const queued = [];

    if (profile.party_type === 'INDIVIDUAL') {
      const license = (profile.documents || []).find(
        (document) => document.document_type === 'DRIVER_LICENSE_FRONT'
      );
      if (shouldSubmitCoordinatorOcr(license)) {
        if (!license.document_id) license.document_id = require('uuid').v4();
        const result = await enqueueComplianceOcr({
          document: license,
          requirement: DRIVER_LICENSE_OCR_REQUIREMENT,
          callbackType: 'coordinator_compliance',
        });
        Object.assign(license, result);
        queued.push('Driver license front');
        profile.markModified('documents');
        await profile.save();
      }
    }

    if (profile.party_type === 'BUSINESS') {
      const session = await CoordinatorComplianceW9EnvelopeModel.findOne({
        coordinator_user_id: coordinator._id,
        status: 'SIGNED',
      }).sort({ created_at: -1 });
      if (shouldSubmitCoordinatorOcr(session)) {
        await enqueueCoordinatorW9Ocr(session);
        await session.save();
        queued.push('Signed W-9');
      }
    }

    return res.data({ queued }, queued.length ? 'Coordinator documents submitted for OCR' : 'No changed coordinator documents require OCR');
  } catch (error) {
    return next(error);
  }
};

exports.ocrResult = async (req, res, next) => {
  try {
    const documentId = String(req.params.documentId || '');
    const extractedFields = { ...(req.body?.extracted_fields || {}) };
    const ocrStatus = req.body?.ocr_status || 'failed';
    const ocrError = req.body?.ocr_error_message || null;
    const profile = await CoordinatorComplianceProfileModel.findOne({
      'documents.document_id': documentId,
    });

    if (profile) {
      const document = profile.documents.find((item) => item.document_id === documentId);
      const extractedName = extractedFields.name || extractedFields.legal_name || extractedFields.full_name;
      // The license can contain personal details; retain only the comparison
      // outcome and the minimal detected name needed for a review explanation.
      ['raw_text', 'lines', 'words', 'text', 'ocr_text', 'detected_text', 'full_text'].forEach((key) => delete extractedFields[key]);
      const nameMatches = nameMatchesProfile(asVendorIdentity(profile), extractedName);
      document.extracted_fields = { name_match: nameMatches };
      document.ocr_completed_at = new Date();
      if (ocrStatus !== 'completed') {
        document.ocr_status = ocrStatus;
        document.ocr_error_message = ocrError || 'OCR could not read the driver license.';
      } else if (!nameMatches) {
        document.ocr_status = 'manual_review';
        document.ocr_error_message = 'OCR could not confirm that the driver license name matches the compliance legal name.';
      } else {
        document.ocr_status = 'completed';
        document.ocr_error_message = null;
      }
      profile.markModified('documents');
      await profile.save();
      return res.data({ profile: toSafeProfile(profile) }, 'Coordinator driver license OCR result processed');
    }

    const session = await CoordinatorComplianceW9EnvelopeModel.findOne({ ocr_document_id: documentId });
    if (!session) throw buildError('Coordinator compliance document not found.', 404);
    const w9Profile = await CoordinatorComplianceProfileModel.findOne({ coordinator_user_id: session.coordinator_user_id });
    if (!w9Profile || w9Profile.party_type !== 'BUSINESS') {
      throw buildError('Coordinator business compliance profile not found.', 404);
    }
    const extractedNames = getDocumentBusinessNames({
      extracted_fields: extractedFields,
    });
    const businessNameMatches = extractedNames.some((name) =>
      nameMatchesProfile(asVendorIdentity(w9Profile), name)
    );
    const extractedTaxId = taxDigits(extractedFields.tax_identifier || extractedFields.ein || extractedFields.ssn);
    const profileTaxId = taxDigits(EncryptionService.decrypt(w9Profile.tax_id_encrypted));
    const taxIdentifierOcrOutcome = getTaxIdentifierOcrOutcome({
      extractedDigits: extractedTaxId,
      profileDigits: profileTaxId,
    });
    const taxIdMatches = taxIdentifierOcrOutcome === 'MATCHED';
    ['raw_text', 'lines', 'words', 'text', 'ocr_text', 'detected_text', 'full_text', 'tax_identifier', 'ein', 'ssn'].forEach((key) => delete extractedFields[key]);
    session.extracted_fields = {
      business_name_match: businessNameMatches,
      tax_identifier_match: taxIdMatches,
      tax_identifier_type: w9Profile.tax_id_type || null,
      tax_identifier_ocr_outcome: taxIdentifierOcrOutcome,
    };
    session.ocr_completed_at = new Date();
    if (ocrStatus !== 'completed') {
      session.ocr_status = ocrStatus;
      session.ocr_error_message = ocrError || 'OCR could not read the signed W-9.';
      session.verification_status = 'REVALIDATION_NEEDED';
    } else if (!businessNameMatches || !taxIdMatches) {
      const mismatchMessage = !businessNameMatches
        ? 'OCR could not confirm that the W-9 legal business name matches the compliance form.'
        : taxIdentifierOcrOutcome === 'NOT_DETECTED'
          ? 'OCR could not read a complete nine-digit EIN or SSN from the W-9.'
          : taxIdentifierOcrOutcome === 'PROFILE_UNAVAILABLE'
            ? 'The compliance form does not contain a usable encrypted tax ID for comparison.'
            : 'OCR could not confirm that the W-9 EIN or SSN matches the compliance form.';
      const mismatchOutcome = getOcrMismatchOutcome({
        message: mismatchMessage,
        revalidationAttempt: session.revalidation_attempt,
      });
      session.ocr_status = mismatchOutcome.ocrStatus;
      session.ocr_error_message = mismatchOutcome.errorMessage;
      session.verification_status = mismatchOutcome.ocrStatus === 'manual_review'
        ? 'MANUAL_REVIEW'
        : 'REVALIDATION_NEEDED';
    } else {
      session.ocr_status = 'completed';
      session.ocr_error_message = null;
      session.verification_status = 'PASSED';
    }
    await session.save();
    return res.data({ w9_session: toSafeSession(session) }, 'Coordinator W-9 OCR result processed');
  } catch (error) {
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
    session.revalidation_attempt = await CoordinatorComplianceW9EnvelopeModel.countDocuments({
      coordinator_user_id: coordinator._id,
      status: 'SIGNED',
      ocr_status: 'revalidation_needed',
    });
    session.signed_document_url = url;
    session.signed_document_key = key;
    session.verification_status = 'PENDING';
    session.completed_at = new Date();
    session.error_message = null;
    // This mirrors the vendor W-9 lifecycle: a completed DocuSign envelope
    // immediately becomes a queued OCR document, without requiring another
    // customer action.
    await enqueueCoordinatorW9Ocr(session);
    await session.save();

    return res.data({ w9_session: toSafeSession(session), pending_ocr: true }, 'Signed coordinator W-9 received and submitted for verification');
  } catch (error) {
    return next(error);
  }
};
