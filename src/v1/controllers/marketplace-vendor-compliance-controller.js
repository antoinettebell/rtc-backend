const { docusign } = require('../../config');
const fs = require('fs');
const { addObjectFromBufferWithKey, addObjectWithKey } = require('../../helper/aws');
const EncryptionService = require('../../helper/encryption');
const DocuSignHelper = require('../../helper/docusign-helper');
const { enqueueComplianceOcr } = require('../../helper/vendor-compliance-ocr-helper');
const { getComplianceRequirement } = require('../../helper/vendor-compliance-config');
const {
  taxDigits,
  getTaxIdentifierOcrOutcome,
  getDocumentBusinessNames,
  getOcrMismatchOutcome,
  nameMatchesProfile,
} = require('../services/vendor-compliance-service');
const {
  MarketplaceVendorComplianceW9EnvelopeModel,
  MarketplaceVendorComplianceProfileModel,
  MarketplaceVendorComplianceProviderVerificationModel,
  EventVendorProfileModel,
  UserModel,
} = require('../../models');

const buildError = (message, code = 400) => Object.assign(new Error(message), { code });

const DRIVER_LICENSE_OCR_REQUIREMENT = { ocrFields: ['name'] };
const BUSINESS_LICENSE_OCR_REQUIREMENT = getComplianceRequirement('BUSINESS_LICENSE');
const COORDINATOR_OCR_COMPARISON_RULE_VERSION = 2;
// Version 6 refreshes a W-9 after the shared IRS form parser update. It does not affect
// the separately verified driver license or vendor compliance records.
const COORDINATOR_W9_OCR_COMPARISON_RULE_VERSION = 6;
const W9_OCR_REQUIREMENT = {
  ocrFields: ['ein', 'business_name', 'tax_classification', 'signature_date'],
};

const asVendorIdentity = (profile = {}) => ({
  legal_business_name: profile.legal_name || null,
  dba: profile.dba_name || null,
});

const getMarketplaceVendor = async (user) => {
  const vendor = await UserModel.findById(user._id);
  if (!vendor || user.userType !== 'VENDOR') {
    throw buildError('Only Marketplace Vendors can manage Marketplace Vendor compliance.', 403);
  }
  return vendor;
};

const requiresPayoutCompliance = () => true;

const safeAddressPart = (value) => {
  const text = String(value || '').trim();
  return text && text.toUpperCase() !== 'NA' ? text : null;
};

const getProfileMailingAddressFields = (profile = {}) => ({
  address_line1: safeAddressPart(profile.mailing_address_line1),
  address_line2: safeAddressPart(profile.mailing_address_line2),
  city: safeAddressPart(profile.mailing_city),
  state: safeAddressPart(profile.mailing_state),
  postal: safeAddressPart(profile.mailing_postal),
  country: safeAddressPart(profile.mailing_country) || 'US',
});

const getProfileMailingAddress = (profile = {}) => {
  const address = getProfileMailingAddressFields(profile);
  const values = [
    address.address_line1,
    address.address_line2,
    [address.city, address.state, address.postal]
      .filter(Boolean)
      .join(' '),
    address.country,
  ].filter(Boolean);
  return values.join(', ') || null;
};

const maskTaxId = (value, type) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length !== 9) return null;
  return `${type}:${'*'.repeat(5)}${digits.slice(-4)}`;
};

const normalizeIdentity = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();

const driverLicenseComparisonSnapshot = (profile) => ({
  legal_name: normalizeIdentity(profile?.legal_name),
});

const w9ComparisonSnapshot = (profile) => ({
  legal_name: normalizeIdentity(profile?.legal_name),
  tax_id_type: profile?.tax_id_type || null,
  tax_id: profile?.tax_id_encrypted
    ? taxDigits(EncryptionService.decrypt(profile.tax_id_encrypted))
    : '',
});

const snapshotMatches = (savedSnapshot, currentSnapshot) => (
  Boolean(savedSnapshot) && JSON.stringify(savedSnapshot) === JSON.stringify(currentSnapshot)
);

// A government ID may show a middle name and may place the surname first,
// while an individual's signed W-9 commonly uses first and last name only.
// For vendor personal identity we require the compliance form's first
// and last tokens to appear on the document; optional middle tokens do not
// create a false mismatch. Business names continue to use the vendor's exact
// name matching rule below.
const personalNameMatches = (profileName, documentName) => {
  const profileTokens = normalizeIdentity(profileName).split(' ').filter(Boolean);
  const documentTokens = new Set(normalizeIdentity(documentName).split(' ').filter(Boolean));
  if (profileTokens.length < 2 || documentTokens.size < 2) return false;
  return documentTokens.has(profileTokens[0]) && documentTokens.has(profileTokens[profileTokens.length - 1]);
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
    mailing_address: getProfileMailingAddressFields(value),
    tax_id_type: value.tax_id_type,
    tax_id_masked: value.tax_id_masked,
    documents: (value.documents || []).map((document) => ({
      document_id: document.document_id,
      document_type: document.document_type,
      file_url: document.file_url,
      original_name: document.original_name,
      uploaded_at: document.uploaded_at,
      review_status: document.review_status,
      ocr_status: document.ocr_status,
      ocr_error_message: document.ocr_error_message,
    })),
  };
};

// The signed W-9 URL is the same limited document link exposed by the existing
// coordinator compliance flow so Marketplace Vendors can open the completed
// document from their compliance card. OCR extraction data remains private.
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
    signed_document_url: value.signed_document_url,
    completed_at: value.completed_at,
  };
};

const getExternalVerification = async (profile) => {
  if (!profile?.tax_id_type) return { provider: null, status: 'NOT_STARTED', passed: false, checks: [] };
  const provider = String(profile.tax_id_type).toUpperCase() === 'SSN' ? 'COMPLYCUBE' : 'COBALT';
  const checkTypes = provider === 'COMPLYCUBE' ? ['SSN'] : ['TIN', 'SOS'];
  const checks = await MarketplaceVendorComplianceProviderVerificationModel.find({
    vendor_user_id: profile.vendor_user_id,
    verification_cycle: Math.max(1, Number(profile.external_verification_cycle || 1)),
    provider,
    check_type: { $in: checkTypes },
  }).lean();
  const byType = Object.fromEntries(checks.map((item) => [item.check_type, item]));
  const passed = checkTypes.every((type) => byType[type]?.status === 'PASSED');
  const statuses = checks.map((item) => item.status);
  const status = passed ? 'PASSED'
    : statuses.includes('PENDING') ? 'PENDING'
      : statuses.includes('RETRYABLE_ERROR') ? 'RETRYABLE_ERROR'
        : statuses.includes('MANUAL_REVIEW') ? 'MANUAL_REVIEW'
          : statuses.includes('FAILED') ? 'FAILED'
            : 'NOT_STARTED';
  return { provider, status, passed, checks };
};

const buildComplianceSummary = ({ profile, session, requiresPayout, externalVerification }) => {
  const requiredDocumentType = profile?.party_type === 'BUSINESS'
    ? 'BUSINESS_LICENSE'
    : 'DRIVER_LICENSE_FRONT';
  const hasRequiredDocument = (profile?.documents || []).some(
    (document) => document.document_type === requiredDocumentType && document.ocr_status === 'completed'
  );
  const hasProfile = Boolean(profile?.party_type && profile?.legal_name);
  const hasBusinessFields = Boolean(profile?.business_address) && (
    profile?.party_type !== 'BUSINESS' || Boolean(profile?.registration_state && profile?.entity_type)
  );
  const requirements = [
    { key: 'PROFILE', label: 'Compliance profile', complete: hasProfile && hasBusinessFields },
    { key: requiredDocumentType, label: profile?.party_type === 'BUSINESS' ? 'Business license' : 'Driver license front', complete: hasRequiredDocument },
  ];
  if (requiresPayout) {
    const cobaltChecks = Object.fromEntries(
      (externalVerification?.checks || []).map((check) => [check.check_type, check])
    );
    requirements.push(
      { key: 'TAX_ID', label: 'EIN or SSN', complete: Boolean(profile?.tax_id_encrypted) },
      { key: 'W9', label: 'Signed W-9', complete: session?.verification_status === 'PASSED' }
    );
    if (String(profile?.tax_id_type).toUpperCase() === 'EIN') {
      requirements.push(
        { key: 'COBALT_TIN', label: 'EIN verification', complete: cobaltChecks.TIN?.status === 'PASSED' },
        { key: 'COBALT_SOS', label: 'State verification', complete: cobaltChecks.SOS?.status === 'PASSED' },
      );
    } else {
      requirements.push({
        key: 'EXTERNAL_IDENTITY_VERIFICATION',
        label: 'ComplyCube identity verification',
        complete: externalVerification?.passed === true,
      });
    }
  }
  const hasPendingReview = (profile?.documents || []).some((document) =>
    document.review_status === 'pending_review' || ['queued', 'processing'].includes(document.ocr_status)
  ) || (requiresPayout && (
    session?.verification_status === 'PENDING' || ['queued', 'processing'].includes(session?.ocr_status) || externalVerification?.status === 'PENDING'
  ));
  const completed = requirements.filter((item) => item.complete).length;
  const score = requirements.length ? Math.round((completed / requirements.length) * 100) : 0;
  return {
    score,
    score_color: score === 100 ? 'green' : score >= 50 ? 'yellow' : 'orange',
    score_label: score === 100 ? 'Compliance complete' : hasPendingReview ? 'Pending review' : 'Needs attention',
    requirements,
    remaining: requirements.filter((item) => !item.complete).map((item) => item.label),
    // External verification begins only from the explicit Verification action,
    // after the internal OCR comparison has passed.
    provider_verification_pending: externalVerification?.status === 'PENDING',
    external_verification: externalVerification || { provider: null, status: 'NOT_STARTED', checks: [] },
  };
};

// Marketplace Vendors deliberately share the vendor compliance evidence
// contract: one identity document, a DocuSign W-9, OCR, and provider checks.
// Their records remain keyed to their own authenticated user IDs.
exports.getMarketplaceVendorCompliance = async (userId) => {
  const profile = await MarketplaceVendorComplianceProfileModel.findOne({
    vendor_user_id: userId,
  });
  const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
    vendor_user_id: userId,
    status: 'SIGNED',
  }).sort({ created_at: -1 });
  return buildComplianceSummary({
    profile,
    session,
    requiresPayout: true,
    externalVerification: await getExternalVerification(profile),
  });
};

// Paid-event access is a separate, backend-owned user flag. Keep it in lockstep
// with the same internal-compliance requirements shown to the vendor so a
// completed W-9/license cannot leave the profile incorrectly limited to free
// events. A vendor who has not opted into paid capabilities remains
// disabled regardless of their document score.
const reconcilePayoutEligibility = async ({ vendor, profile, session, externalVerification = null }) => {
  const requiresPayout = requiresPayoutCompliance(vendor);
  const verification = externalVerification || await getExternalVerification(profile);
  const compliance = buildComplianceSummary({ profile, session, requiresPayout, externalVerification: verification });
  const nextEligibility = requiresPayout && compliance.score === 100
    ? 'ENABLED'
    : 'DISABLED';
  return { compliance, payoutEligibility: nextEligibility };
};

const enqueueMarketplaceVendorW9Ocr = async (session) => {
  const result = await enqueueComplianceOcr({
    document: {
      document_id: session.ocr_document_id,
      file_url: session.signed_document_url,
      file_key: session.signed_document_key,
      mime_type: 'application/pdf',
      document_type: 'W9',
    },
    requirement: W9_OCR_REQUIREMENT,
    callbackType: 'marketplace_vendor_compliance',
  });
  Object.assign(session, result);
  return session;
};

// Mirror the vendor lifecycle: normal Save & Run OCR submits new evidence
// only, but may recover a request that has remained queued for two minutes.
// This prevents duplicate active jobs while allowing a failed handoff to be
// retried from the one shared save action.
const shouldSubmitMarketplaceVendorOcr = (record) => {
  if (!record) return false;
  if (record.ocr_status === 'not_configured') return true;
  if (record.ocr_status !== 'queued') return false;
  const requestedAt = record.ocr_requested_at
    ? new Date(record.ocr_requested_at).getTime()
    : 0;
  return !requestedAt || Date.now() - requestedAt >= 2 * 60 * 1000;
};

const getOrMigrateProfile = async (vendor) =>
  MarketplaceVendorComplianceProfileModel.findOne({ vendor_user_id: vendor._id });

exports.status = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
      vendor_user_id: vendor._id,
    }).sort({ created_at: -1 });
    const profile = await getOrMigrateProfile(vendor);
    const requiresPayout = requiresPayoutCompliance(vendor);
    const { compliance, payoutEligibility } = await reconcilePayoutEligibility({
      vendor,
      profile,
      session,
    });
    return res.data({
      payout_eligibility: payoutEligibility,
      requires_payout_compliance: requiresPayout,
      w9_session: toSafeSession(session),
      profile: toSafeProfile(profile),
      mailing_address: getProfileMailingAddress(profile),
      mailing_address_fields: getProfileMailingAddressFields(profile),
      compliance,
    }, 'MarketplaceVendor compliance status');
  } catch (error) {
    return next(error);
  }
};

exports.saveProfile = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    const marketplaceProfile = await EventVendorProfileModel.findOne({
      vendor_user_id: vendor._id,
      status: 'ACTIVE',
    }).lean();
    if (!marketplaceProfile) throw buildError('Save the Marketplace Vendor profile before compliance.', 409);
    const partyType = String(req.body?.party_type || '').toUpperCase();
    if (!['INDIVIDUAL', 'BUSINESS'].includes(partyType)) {
      throw buildError('Choose whether the vendor is an individual or business.');
    }
    const legalName = String(req.body?.legal_name || '').trim();
    if (!legalName) throw buildError('Legal name is required.');
    const mailingAddress = req.body?.mailing_address || {};
    const hasStructuredMailingAddress = Object.keys(mailingAddress).length > 0;
    const mailingAddressFields = {
      mailing_address_line1: safeAddressPart(mailingAddress.address_line1),
      mailing_address_line2: safeAddressPart(mailingAddress.address_line2),
      mailing_city: safeAddressPart(mailingAddress.city),
      mailing_state: safeAddressPart(mailingAddress.state),
      mailing_postal: safeAddressPart(mailingAddress.postal),
      mailing_country: safeAddressPart(mailingAddress.country) || 'US',
    };
    if (hasStructuredMailingAddress && (
      !mailingAddressFields.mailing_address_line1 || !mailingAddressFields.mailing_city ||
      !mailingAddressFields.mailing_state || !mailingAddressFields.mailing_postal
    )) {
      throw buildError('Mailing address, city, state, and ZIP code are required.');
    }
    const structuredBusinessAddress = hasStructuredMailingAddress
      ? [
        mailingAddressFields.mailing_address_line1,
        mailingAddressFields.mailing_address_line2,
        [mailingAddressFields.mailing_city, mailingAddressFields.mailing_state, mailingAddressFields.mailing_postal]
          .filter(Boolean)
          .join(' '),
        mailingAddressFields.mailing_country,
      ].filter(Boolean).join(', ')
      : null;
    const businessAddress = structuredBusinessAddress || String(req.body?.business_address || '').trim();
    if (!businessAddress) throw buildError('Mailing address is required.');
    // A correction to the comparison data is a meaningful OCR change even
    // when the uploaded file itself is unchanged. Preserve the document, but
    // make the affected comparison eligible for the one shared Save & Run OCR
    // action again. This is the same evidence lifecycle the vendor screen
    // applies after a profile/document correction.
    const previousProfile = await MarketplaceVendorComplianceProfileModel.findOne({
      vendor_user_id: vendor._id,
    });
    const previousTaxId = previousProfile?.tax_id_encrypted
      ? taxDigits(EncryptionService.decrypt(previousProfile.tax_id_encrypted))
      : '';
    const profile = await MarketplaceVendorComplianceProfileModel.findOneAndUpdate(
      { vendor_user_id: vendor._id },
      {
        $set: {
          marketplace_vendor_profile_id: marketplaceProfile.profile_id,
          party_type: partyType,
          legal_name: legalName,
          dba_name: partyType === 'BUSINESS' ? String(req.body?.dba_name || '').trim() || null : null,
          entity_type: partyType === 'BUSINESS' ? String(req.body?.entity_type || '').toUpperCase() || null : null,
          registration_state: partyType === 'BUSINESS' ? String(req.body?.registration_state || '').toUpperCase() || null : null,
          // This legacy-named profile field is the verified legal mailing
          // address for both business and individual Marketplace Vendors.
          business_address: businessAddress,
          ...mailingAddressFields,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const taxId = String(req.body?.tax_id || '').replace(/\D/g, '');
    const taxIdType = String(req.body?.tax_id_type || '').toUpperCase();
    if (taxId || taxIdType) {
      const expectedTaxIdType = partyType === 'BUSINESS' ? 'EIN' : 'SSN';
      if (taxIdType !== expectedTaxIdType || taxId.length !== 9) {
        throw buildError(partyType === 'BUSINESS'
          ? 'A nine-digit EIN is required for a business vendor.'
          : 'A nine-digit SSN is required for an individual vendor.');
      }
      // The encrypted value remains in the compliance record only. Provider
      // selection is intentionally deferred to the verification service.
      profile.tax_id_type = taxIdType;
      profile.tax_id_encrypted = EncryptionService.encrypt(taxId);
      profile.tax_id_masked = maskTaxId(taxId, taxIdType);
      await profile.save();
    }

    const identityChanged = Boolean(previousProfile) && (
      previousProfile.party_type !== partyType ||
      normalizeIdentity(previousProfile.legal_name) !== normalizeIdentity(legalName)
    );
    const taxIdChanged = Boolean(previousProfile && (taxId || taxIdType)) && (
      previousProfile.tax_id_type !== taxIdType || previousTaxId !== taxId
    );
    if (identityChanged || taxIdChanged) {
      profile.external_verification_cycle = Math.max(1, Number(profile.external_verification_cycle || 1)) + 1;
      await MarketplaceVendorComplianceProviderVerificationModel.updateMany(
        {
          vendor_user_id: vendor._id,
          status: { $in: ['NOT_STARTED', 'PENDING', 'PASSED', 'RETRYABLE_ERROR'] },
        },
        { $set: { status: 'SUPERSEDED', completed_at: new Date() } }
      );
    }
    const requiredDocumentType = partyType === 'BUSINESS' ? 'BUSINESS_LICENSE' : 'DRIVER_LICENSE_FRONT';
    const document = (profile.documents || []).find((item) => item.document_type === requiredDocumentType);
    const documentComparisonChanged = Boolean(document) && !snapshotMatches(
      document.ocr_comparison_snapshot,
      driverLicenseComparisonSnapshot(profile)
    );
    const documentRulesChanged = Boolean(document) &&
      document.ocr_comparison_rule_version !== COORDINATOR_OCR_COMPARISON_RULE_VERSION;
    if (identityChanged || documentComparisonChanged || documentRulesChanged) {
      if (document) {
        document.ocr_status = 'not_configured';
        document.ocr_requested_at = null;
        document.ocr_completed_at = null;
        document.ocr_error_message = null;
        document.review_status = 'pending_review';
        profile.markModified('documents');
      }
    }
    const signedW9 = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
      vendor_user_id: vendor._id,
      status: 'SIGNED',
    }).sort({ created_at: -1 });
    const w9ComparisonChanged = Boolean(signedW9) && !snapshotMatches(
      signedW9.ocr_comparison_snapshot,
      w9ComparisonSnapshot(profile)
    );
    const w9RulesChanged = Boolean(signedW9) &&
      signedW9.ocr_comparison_rule_version !== COORDINATOR_W9_OCR_COMPARISON_RULE_VERSION;
    if (identityChanged || taxIdChanged || w9ComparisonChanged || w9RulesChanged) {
      if (signedW9) {
        signedW9.ocr_status = 'not_configured';
        signedW9.ocr_requested_at = null;
        signedW9.ocr_completed_at = null;
        signedW9.ocr_error_message = null;
        signedW9.verification_status = 'PENDING';
        await signedW9.save();
      }
    }
    if (identityChanged || taxIdChanged || documentComparisonChanged || documentRulesChanged) await profile.save();
    await reconcilePayoutEligibility({ vendor, profile, session: signedW9 });
    return res.data({ profile: toSafeProfile(profile) }, 'MarketplaceVendor compliance profile saved');
  } catch (error) {
    return next(error);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    if (!req.file) throw buildError('Choose a document to upload.');
    const documentType = String(req.body?.document_type || '').toUpperCase();
    if (!['DRIVER_LICENSE_FRONT', 'BUSINESS_LICENSE'].includes(documentType)) {
      throw buildError('Unsupported vendor compliance document.');
    }
    const profile = await getOrMigrateProfile(vendor);
    if (!profile) throw buildError('Save the vendor compliance profile before uploading documents.', 409);
    if (profile.party_type === 'INDIVIDUAL' && documentType !== 'DRIVER_LICENSE_FRONT') {
      throw buildError('Individuals only need the front of a driver license.');
    }
    if (profile.party_type === 'BUSINESS' && documentType !== 'BUSINESS_LICENSE') {
      throw buildError('Businesses must upload a business license.');
    }
    const { url, key } = await addObjectWithKey(req.file, `marketplace-vendor-compliance/${vendor._id}/${documentType}`);
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
    const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
      vendor_user_id: vendor._id,
    }).sort({ created_at: -1 });
    await reconcilePayoutEligibility({ vendor, profile, session });
    fs.unlink(req.file.path, () => {});
    return res.data({ profile: toSafeProfile(profile) }, 'MarketplaceVendor compliance document uploaded');
  } catch (error) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return next(error);
  }
};

// Only vendor compliance documents use this route. It deliberately
// compares against the isolated compliance profile, never the customer user
// profile. Existing verified OCR is left untouched until the evidence changes.
exports.submitDocumentsForOcr = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    const profile = await getOrMigrateProfile(vendor);
    if (!profile) throw buildError('Save vendor compliance information before running OCR.', 409);
    const queued = [];

    const requiredDocumentType = profile.party_type === 'BUSINESS'
      ? 'BUSINESS_LICENSE'
      : 'DRIVER_LICENSE_FRONT';
    const requiredDocument = (profile.documents || []).find(
      (document) => document.document_type === requiredDocumentType
    );
    if (shouldSubmitMarketplaceVendorOcr(requiredDocument)) {
      if (!requiredDocument.document_id) requiredDocument.document_id = require('uuid').v4();
      requiredDocument.ocr_comparison_snapshot = driverLicenseComparisonSnapshot(profile);
      requiredDocument.ocr_comparison_rule_version = COORDINATOR_OCR_COMPARISON_RULE_VERSION;
      const result = await enqueueComplianceOcr({
        document: requiredDocument,
        requirement: profile.party_type === 'BUSINESS'
          ? BUSINESS_LICENSE_OCR_REQUIREMENT
          : DRIVER_LICENSE_OCR_REQUIREMENT,
        callbackType: 'marketplace_vendor_compliance',
      });
      Object.assign(requiredDocument, result);
      requiredDocument.review_status = 'pending_review';
      queued.push(profile.party_type === 'BUSINESS' ? 'Business license' : 'Driver license front');
      profile.markModified('documents');
      await profile.save();
    }

    // A signed W-9 is required for either paid vendor type. The vendor
    // lifecycle is tax-ID agnostic: business vendors use EIN, while
    // individual vendors use SSN.
    if (requiresPayoutCompliance(vendor)) {
      const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
        vendor_user_id: vendor._id,
        status: 'SIGNED',
      }).sort({ created_at: -1 });
      if (shouldSubmitMarketplaceVendorOcr(session)) {
        session.ocr_comparison_snapshot = w9ComparisonSnapshot(profile);
        session.ocr_comparison_rule_version = COORDINATOR_W9_OCR_COMPARISON_RULE_VERSION;
        await enqueueMarketplaceVendorW9Ocr(session);
        await session.save();
        queued.push('Signed W-9');
      }
    }

    const w9Session = requiresPayoutCompliance(vendor)
      ? await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
        vendor_user_id: vendor._id,
        status: 'SIGNED',
      }).sort({ created_at: -1 })
      : null;
    const externalVerification = await getExternalVerification(profile);
    return res.data({
      queued,
      profile: toSafeProfile(profile),
      w9_session: toSafeSession(w9Session),
      compliance: buildComplianceSummary({ profile, session: w9Session, requiresPayout: requiresPayoutCompliance(vendor), externalVerification }),
    }, queued.length ? 'MarketplaceVendor documents submitted for OCR' : 'No changed vendor documents require OCR');
  } catch (error) {
    return next(error);
  }
};

exports.startExternalVerification = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    if (!requiresPayoutCompliance(vendor)) {
      throw buildError('Enable ticket sales or vendor-fee payouts before requesting verification.', 409);
    }
    const profile = await getOrMigrateProfile(vendor);
    const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
      vendor_user_id: vendor._id,
      status: 'SIGNED',
    }).sort({ created_at: -1 });
    const before = buildComplianceSummary({
      profile,
      session,
      requiresPayout: true,
      externalVerification: await getExternalVerification(profile),
    });
    const internalComplete = before.requirements
      .filter((requirement) => ![
        'EXTERNAL_IDENTITY_VERIFICATION',
        'COBALT_TIN',
        'COBALT_SOS',
      ].includes(requirement.key))
      .every((requirement) => requirement.complete);
    if (!internalComplete) {
      throw buildError('Complete internal compliance before requesting identity verification.', 409);
    }
    const ProviderHelper = require('../../helper/vendor-compliance-provider-helper');
    const isIndividualSsn = profile.party_type === 'INDIVIDUAL' && profile.tax_id_type === 'SSN';
    const checkType = ['TIN', 'SOS'].includes(String(req.body?.check_type || '').toUpperCase())
      ? String(req.body.check_type).toUpperCase()
      : null;
    const verification = isIndividualSsn
      ? await ProviderHelper.startMarketplaceVendorComplyCubeSsnCheck({ vendor, profile })
      : await ProviderHelper.startMarketplaceVendorCobaltEinChecks({ vendor, profile, checkType });
    if (!verification || (Array.isArray(verification) && !verification.length)) {
      throw buildError(isIndividualSsn ? 'ComplyCube verification is not configured.' : 'Cobalt verification is not configured.', 503);
    }
    const reconciled = await reconcilePayoutEligibility({ vendor, profile, session });
    return res.data({ verification, compliance: reconciled.compliance }, 'Identity verification requested');
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
    const profile = await MarketplaceVendorComplianceProfileModel.findOne({
      'documents.document_id': documentId,
    });

    if (profile) {
      const document = profile.documents.find((item) => item.document_id === documentId);
      const extractedName = profile.party_type === 'BUSINESS'
        ? extractedFields.business_name || extractedFields.legal_business_name || extractedFields.name
        : extractedFields.name || extractedFields.legal_name || extractedFields.full_name;
      // The license can contain personal details; retain only the comparison
      // outcome and the minimal detected name needed for a review explanation.
      ['raw_text', 'lines', 'words', 'text', 'ocr_text', 'detected_text', 'full_text'].forEach((key) => delete extractedFields[key]);
      const nameMatches = profile.party_type === 'BUSINESS'
        ? nameMatchesProfile(asVendorIdentity(profile), extractedName)
        : personalNameMatches(profile.legal_name, extractedName);
      document.extracted_fields = { name_match: nameMatches };
      document.ocr_completed_at = new Date();
      if (ocrStatus !== 'completed') {
        document.ocr_status = ocrStatus;
        document.ocr_error_message = ocrError || 'OCR could not read the driver license.';
        document.review_status = 'revalidation_needed';
      } else if (!nameMatches) {
        document.ocr_status = 'manual_review';
        document.ocr_error_message = `OCR could not confirm that the ${profile.party_type === 'BUSINESS' ? 'business license' : 'driver license'} name matches the compliance legal name.`;
        document.review_status = 'manual_review';
      } else {
        document.ocr_status = 'completed';
        document.ocr_error_message = null;
        document.review_status = 'verified';
      }
      profile.markModified('documents');
      await profile.save();
      const vendor = await UserModel.findById(profile.vendor_user_id);
      const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
        vendor_user_id: profile.vendor_user_id,
      }).sort({ created_at: -1 });
      if (vendor) await reconcilePayoutEligibility({ vendor, profile, session });
      return res.data({ profile: toSafeProfile(profile) }, 'MarketplaceVendor driver license OCR result processed');
    }

    const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({ ocr_document_id: documentId });
    if (!session) throw buildError('MarketplaceVendor compliance document not found.', 404);
    const w9Profile = await MarketplaceVendorComplianceProfileModel.findOne({ vendor_user_id: session.vendor_user_id });
    if (!w9Profile) {
      throw buildError('MarketplaceVendor compliance profile not found.', 404);
    }
    // W-9 Line 1 (taxpayer_name) is the individual's legal-name field. Line
    // 2 is only a business/disregarded-entity name and must not participate in
    // an individual vendor's identity comparison. Businesses continue to
    // use the exact vendor W-9 candidate set unchanged.
    const extractedNames = w9Profile.party_type === 'BUSINESS'
      ? getDocumentBusinessNames({ extracted_fields: extractedFields })
      : [extractedFields.taxpayer_name].filter(Boolean);
    const businessNameMatches = extractedNames.some((name) => (
      w9Profile.party_type === 'BUSINESS'
        ? nameMatchesProfile(asVendorIdentity(w9Profile), name)
        : personalNameMatches(w9Profile.legal_name, name)
    ));
    const extractedTaxId = taxDigits(extractedFields.tax_identifier || extractedFields.ein || extractedFields.ssn);
    const profileTaxId = taxDigits(EncryptionService.decrypt(w9Profile.tax_id_encrypted));
    const taxIdentifierOcrOutcome = getTaxIdentifierOcrOutcome({
      extractedDigits: extractedTaxId,
      profileDigits: profileTaxId,
    });
    const taxIdMatches = taxIdentifierOcrOutcome === 'MATCHED';
    // Diagnostic metadata only: do not log an extracted name, tax ID, OCR
    // text, or callback body. This distinguishes a missing W-9 field from a
    // comparison rule mismatch in the deployed flow.
    console.info('MarketplaceVendor W-9 OCR comparison', {
      documentId,
      partyType: w9Profile.party_type,
      taxpayerNamePresent: Boolean(extractedFields.taxpayer_name),
      businessNamePresent: Boolean(extractedFields.business_name),
      extractedNameCount: extractedNames.length,
      nameMatched: businessNameMatches,
      taxIdentifierOutcome: taxIdentifierOcrOutcome,
    });
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
        ? `OCR could not confirm that the W-9 ${w9Profile.party_type === 'BUSINESS' ? 'legal business name' : 'taxpayer name'} matches the compliance form.`
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
    const vendor = await UserModel.findById(session.vendor_user_id);
    if (vendor) await reconcilePayoutEligibility({ vendor, profile: w9Profile, session });
    return res.data({ w9_session: toSafeSession(session) }, 'MarketplaceVendor W-9 OCR result processed');
  } catch (error) {
    return next(error);
  }
};

exports.startW9Signing = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    if (!requiresPayoutCompliance(vendor)) {
      throw buildError('Enable ticket sales or vendor-fee payouts before signing a W-9.', 409);
    }
    const profile = await getOrMigrateProfile(vendor);
    if (!profile?.tax_id_encrypted || !profile?.tax_id_masked) {
      throw buildError('Add your EIN or SSN in MarketplaceVendor Compliance before signing a W-9.', 409);
    }

    // The legal compliance name, not the account's consumer-profile name,
    // must be the DocuSign recipient name and prefilled W-9 signer.
    const signerName = profile.legal_name || [vendor.firstName, vendor.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Marketplace Vendor';
    const envelope = await DocuSignHelper.createVendorComplianceW9Envelope({
      vendorName: signerName,
      vendorEmail: vendor.email,
      vendorUserId: vendor._id,
    });
    const envelopeId = String(envelope?.envelopeId || envelope?.envelope_id || '').trim();
    if (!envelopeId) throw new Error('DocuSign did not create a W-9 signing session.');

    const recipients = await DocuSignHelper.getEnvelopeRecipients(envelopeId);
    const signer = (recipients?.signers || []).find(
      (item) => String(item?.clientUserId || '') === String(vendor._id)
    );
    if (!signer?.recipientId) throw new Error('DocuSign did not return the W-9 signer.');
    const view = await DocuSignHelper.createRecipientView({
      envelopeId,
      signerName,
      signerEmail: vendor.email,
      vendorUserId: vendor._id,
      recipientId: signer.recipientId,
      returnUrl: 'rounddacornervendor://docusign/return?status=completed',
    });
    const session = await MarketplaceVendorComplianceW9EnvelopeModel.create({
      vendor_user_id: vendor._id,
      marketplace_vendor_profile_id: profile.marketplace_vendor_profile_id,
      envelope_id: envelopeId,
      verification_status: 'PENDING',
    });
    return res.data({
      envelope_id: envelopeId,
      signing_url: view?.url,
      w9_session: toSafeSession(session),
    }, 'MarketplaceVendor W-9 signing started');
  } catch (error) {
    return next(error);
  }
};

exports.completeW9Signing = async (req, res, next) => {
  try {
    const vendor = await getMarketplaceVendor(req.user);
    const envelopeId = String(req.body?.envelope_id || '').trim();
    if (!envelopeId) throw buildError('W-9 signing session is required.');
    const session = await MarketplaceVendorComplianceW9EnvelopeModel.findOne({
      vendor_user_id: vendor._id,
      envelope_id: envelopeId,
    });
    if (!session) throw buildError('MarketplaceVendor W-9 signing session not found.', 404);
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
        originalname: `signed-vendor-w9-${envelopeId}.pdf`,
        mimetype: 'application/pdf',
      },
      `marketplace-vendor-compliance/${vendor._id}/W9`
    );
    session.status = 'SIGNED';
    session.revalidation_attempt = await MarketplaceVendorComplianceW9EnvelopeModel.countDocuments({
      vendor_user_id: vendor._id,
      status: 'SIGNED',
      ocr_status: 'revalidation_needed',
    });
    session.signed_document_url = url;
    session.signed_document_key = key;
    session.verification_status = 'PENDING';
    session.completed_at = new Date();
    session.error_message = null;
    const profile = await MarketplaceVendorComplianceProfileModel.findOne({ vendor_user_id: vendor._id });
    session.ocr_comparison_snapshot = w9ComparisonSnapshot(profile);
    session.ocr_comparison_rule_version = COORDINATOR_W9_OCR_COMPARISON_RULE_VERSION;
    // This mirrors the vendor W-9 lifecycle: a completed DocuSign envelope
    // immediately becomes a queued OCR document, without requiring another
    // customer action.
    await enqueueMarketplaceVendorW9Ocr(session);
    await session.save();

    return res.data({ w9_session: toSafeSession(session), pending_ocr: true }, 'Signed vendor W-9 received and submitted for verification');
  } catch (error) {
    return next(error);
  }
};

