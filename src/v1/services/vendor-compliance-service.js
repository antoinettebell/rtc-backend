const {
  FoodTruckService,
  MarketplaceAttachmentService,
  VendorComplianceDocumentService,
  VendorComplianceAuditService,
} = require('./index');
const {
  SUPPORT_PHONE_NUMBER,
  GRANDFATHER_CUTOFF_DATE,
  REMINDER_DAYS,
  getComplianceRequirement,
  getComplianceRequirements,
  normalizeComplianceDocumentType,
} = require('../../helper/vendor-compliance-config');
const { enqueueComplianceOcr } = require('../../helper/vendor-compliance-ocr-helper');
const CustomNotification = require('../../helper/custom-notification');
const { getSignedObjectUrl, removeObject, addObjectFromBufferWithKey } = require('../../helper/aws');
const EncryptionService = require('../../helper/encryption');
const {
  FoodTruckModel,
  VendorComplianceProviderVerificationModel,
} = require('../../models');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const buildComplianceError = (message, statusCode = 409, summary = null) => {
  const error = new Error(message);
  error.code = statusCode;
  error.compliance = summary;
  return error;
};

// A vendor gets one self-service correction attempt for an OCR/profile
// mismatch. Only a mismatch on the replacement moves the document to Support
// review. This keeps the vendor-facing state aligned with the compliance
// policy without retaining any sensitive OCR values.
const getOcrMismatchOutcome = ({ message, revalidationAttempt = 0 }) => {
  const requiresManualReview = Number(revalidationAttempt || 0) > 0;
  return {
    reviewStatus: requiresManualReview ? 'manual_review' : 'revalidation_needed',
    ocrStatus: requiresManualReview ? 'manual_review' : 'revalidation_needed',
    errorMessage: requiresManualReview
      ? `${message} This replacement requires manual review.`
      : message,
  };
};

const applyOcrMismatchOutcome = (document, message) => {
  const outcome = getOcrMismatchOutcome({
    message,
    revalidationAttempt: document.revalidation_attempt,
  });
  document.review_status = outcome.reviewStatus;
  document.ocr_status = outcome.ocrStatus;
  document.ocr_error_message = outcome.errorMessage;
};

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getDateKey = (value) => {
  const date = asDate(value);
  return date ? date.toISOString().slice(0, 10) : null;
};

const getDaysUntil = (date, now = new Date()) => {
  const parsed = asDate(date);
  if (!parsed) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / MS_PER_DAY);
};

const isGrandfatheredVendor = (foodTruck) => {
  const cutoffDate = asDate(GRANDFATHER_CUTOFF_DATE);
  if (!cutoffDate || !foodTruck?.createdAt) return false;

  const createdAt = asDate(foodTruck.createdAt);
  return !!createdAt && createdAt < cutoffDate;
};

const getFirstFieldValue = (fields = {}, names = []) => {
  for (const name of names) {
    const value = fields?.[name];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return null;
};

const getOcrExpirationDate = (fields = {}) =>
  getFirstFieldValue(fields, [
    'expiration_date',
    'expirationDate',
    'expiry_date',
    'expiryDate',
    'expires_at',
    'expiresAt',
    'exp_date',
    'expDate',
    'valid_until',
    'validUntil',
    'valid_through',
    'validThrough',
  ]);

const getOcrIssueDate = (fields = {}) =>
  getFirstFieldValue(fields, [
    'issue_date',
    'issueDate',
    'issued_date',
    'issuedDate',
    'effective_date',
    'effectiveDate',
    'inspection_date',
    'inspectionDate',
  ]);

const taxDigits = (value) => String(value || '').replace(/\D/g, '');
const getTaxIdentifierOcrOutcome = ({ extractedDigits, profileDigits }) => {
  if (String(extractedDigits || '').length !== 9) return 'NOT_DETECTED';
  if (String(profileDigits || '').length !== 9) return 'PROFILE_UNAVAILABLE';
  return extractedDigits === profileDigits ? 'MATCHED' : 'MISMATCH';
};
const normalizeName = (value) => String(value || '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');
const profileBusinessNames = (foodTruck = {}) => {
  const complianceNames = [foodTruck.legal_business_name, foodTruck.dba]
    .map(normalizeName)
    .filter(Boolean);

  // Older vendor profiles can predate the dedicated Legal Business Name/DBA
  // fields. Use the food-truck name only for those legacy profiles; once a
  // compliance identity is present, it remains the authoritative comparison.
  if (!complianceNames.length) {
    const foodTruckName = normalizeName(foodTruck.name);
    if (foodTruckName) complianceNames.push(foodTruckName);
  }

  return new Set(complianceNames);
};
const nameMatchesProfile = (foodTruck, value) => {
  const normalized = normalizeName(value);
  return !!normalized && profileBusinessNames(foodTruck).has(normalized);
};

const hasValidTaxIdentifier = (value) => taxDigits(value).length === 9;
const hasMaskedTaxIdentifier = (value) => {
  const text = String(value || '');
  return text.includes('*') && taxDigits(text).length >= 4;
};
const hasEncryptedTaxIdentifier = (foodTruck, type) =>
  String(foodTruck?.tax_identifier_type || '').toUpperCase() === type &&
  !!foodTruck?.tax_identifier_masked;

const CORE_IDENTITY_DOCUMENT_TYPE = 'DRIVER_LICENSE_FRONT';

const getVerificationCycle = (foodTruck = {}) =>
  Math.max(1, Number(foodTruck.compliance_verification_cycle || 1));

const SANITATION_GRADE_FIELDS = [
  'sanitation_grade',
  'sanitationGrade',
  'grade',
  'letter_grade',
  'inspection_grade',
  'rating',
  'sanitation_rating',
];

const normalizeSanitationGrade = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;

  const letterMatch = text.match(/\b([ABCDF])\b/);
  if (letterMatch) return letterMatch[1];

  const numericMatch = text.match(/\b(100|[1-9]?\d)(?:\.\d+)?\b/);
  if (!numericMatch) return null;

  const score = Number(numericMatch[1]);
  if (!Number.isFinite(score)) return null;
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
};

const getManualSanitationGrade = (body = {}) =>
  normalizeSanitationGrade(
    body.sanitation_grade ||
      body.sanitationGrade ||
      body.grade ||
      body.letter_grade ||
      body.inspection_grade
  );

const getSanitationGradeFromFields = (fields = {}) => {
  for (const fieldName of SANITATION_GRADE_FIELDS) {
    const grade = normalizeSanitationGrade(fields?.[fieldName]);
    if (grade) return grade;
  }

  return normalizeSanitationGrade(
    fields?.raw_text ||
      fields?.text ||
      fields?.ocr_text ||
      fields?.detected_text ||
      fields?.full_text
  );
};

const getSanitationGradeFromDocument = (document = {}) =>
  getSanitationGradeFromFields({
    ...(document?.extracted_fields || {}),
    ...(document?.metadata || {}),
    sanitation_grade: document?.sanitation_grade,
    sanitationGrade: document?.sanitationGrade,
    grade: document?.grade,
    letter_grade: document?.letter_grade,
    inspection_grade: document?.inspection_grade,
  });

const getSanitationGradeRank = (grade) => {
  const normalized = normalizeSanitationGrade(grade);
  if (!normalized) return null;
  return { A: 5, B: 4, C: 3, D: 2, F: 1 }[normalized] || null;
};

const isSanitationGradeEligible = (grade) => {
  const rank = getSanitationGradeRank(grade);
  return rank !== null && rank >= getSanitationGradeRank('B');
};

const getScoreBand = ({ score, eligible, hasPendingReview }) => {
  if (score < 25) {
    return {
      color: 'red',
      label: 'Blocked',
      hex: '#D93025',
    };
  }

  if (score < 50) {
    return {
      color: 'orange',
      label: 'Needs attention',
      hex: '#F97316',
    };
  }

  if (score < 100 || hasPendingReview || !eligible) {
    return {
      color: 'yellow',
      label: hasPendingReview ? 'Pending review' : 'In progress',
      hex: '#F9AB00',
    };
  }

  return {
    color: 'green',
    label: score >= 100 ? 'Complete' : 'On track',
    hex: '#188038',
  };
};

const isVerifiedActiveDocument = (document, now = new Date()) => {
  if (!document || document.review_status !== 'verified' || document.archived_at) {
    return false;
  }

  if (document.document_type === 'HEALTH_PERMIT') return true;

  const expirationDate = asDate(document.expiration_date);
  return !expirationDate || expirationDate >= now;
};

const getCurrentDocuments = async (foodTruckId) =>
  VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruckId,
      review_status: { $ne: 'archived' },
      archived_at: null,
    },
    { sort: { created_at: -1 }, lean: true }
  );

const selectLatestByType = (documents = []) =>
  documents.reduce((acc, document) => {
    const current = acc[document.document_type];
    if (!current) {
      acc[document.document_type] = document;
      return acc;
    }
    // A replacement W-9 must not interrupt an already verified certification
    // while DocuSign completion and OCR validation are still pending.
    if (
      document.document_type === 'W9' &&
      current.review_status !== 'verified' &&
      document.review_status === 'verified'
    ) {
      acc[document.document_type] = document;
    }
    return acc;
  }, {});

// The summary deliberately keeps a verified W-9 visible while a replacement
// is pending. An explicit OCR retry is different: it must target the newest
// saved document, including a replacement in revalidation/manual-review.
const selectNewestByType = (documents = []) =>
  documents.reduce((acc, document) => {
    if (!acc[document.document_type]) acc[document.document_type] = document;
    return acc;
  }, {});

const getFoodTruckDocumentComplianceStatus = (document = null) => {
  if (!document) return 'NEEDS_SYNC';
  if (document.review_status === 'verified') return 'VERIFIED';
  if (document.review_status === 'rejected') return 'REJECTED';
  if (document.review_status === 'expired') return 'EXPIRED';
  if (document.archived_at || document.review_status === 'archived') {
    return 'ARCHIVED';
  }
  return 'PENDING_REVIEW';
};

const applyComplianceStatusToFoodTruckDocument = (legacyDocument, complianceDocument) => {
  if (!legacyDocument) return false;

  const nextStatus = complianceDocument
    ? getFoodTruckDocumentComplianceStatus(complianceDocument)
    : 'NOT_APPLICABLE';
  const nextValues = {
    compliance_status: nextStatus,
    compliance_document_id: complianceDocument?.document_id || null,
    compliance_document_type: complianceDocument?.document_type || null,
    compliance_review_status: complianceDocument?.review_status || null,
    compliance_ocr_status: complianceDocument?.ocr_status || null,
  };

  let changed = false;
  Object.entries(nextValues).forEach(([key, value]) => {
    if (String(legacyDocument[key] || '') !== String(value || '')) {
      legacyDocument[key] = value;
      changed = true;
    }
  });

  if (changed) {
    legacyDocument.compliance_synced_at = new Date();
  }
  return changed;
};

const updateLinkedFoodTruckDocumentComplianceStatus = async (complianceDocument) => {
  if (!complianceDocument?.food_truck_id) return false;

  const foodTruck = await FoodTruckService.getByData(
    { _id: complianceDocument.food_truck_id },
    { singleResult: true }
  );
  if (!foodTruck) return false;

  let changed = false;
  for (const legacyDocument of foodTruck.documents || []) {
    const matches =
      legacyDocument.compliance_document_id === complianceDocument.document_id ||
      legacyDocument.file_url === complianceDocument.file_url ||
      (legacyDocument.file_key &&
        complianceDocument.file_key &&
        legacyDocument.file_key === complianceDocument.file_key);

    if (matches) {
      changed =
        applyComplianceStatusToFoodTruckDocument(
          legacyDocument,
          complianceDocument
        ) || changed;
    }
  }

  if (changed) {
    await foodTruck.save();
  }
  return changed;
};

const getLatestSanitationGradeDocument = (documents = [], now = new Date()) =>
  documents.find(
    (document) =>
      document.document_type === 'HEALTH_PERMIT' &&
      isVerifiedActiveDocument(document, now) &&
      getSanitationGradeFromDocument(document)
  ) || null;

const getLatestProvidedSanitationGradeDocument = (documents = []) =>
  documents.find((document) => {
    if (
      document.document_type !== 'HEALTH_PERMIT' ||
      document.archived_at ||
      document.review_status === 'rejected'
    ) {
      return false;
    }

    return getSanitationGradeFromDocument(document);
  }) || null;

const getSanitationGradeMap = async (foodTruckIds = []) => {
  const ids = [...new Set((foodTruckIds || []).filter(Boolean).map((id) => id.toString()))];
  if (!ids.length) return {};

  const documents = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: { $in: ids },
      document_type: 'HEALTH_PERMIT',
      review_status: 'verified',
      archived_at: null,
    },
    { lean: true, sort: { created_at: -1 } }
  );

  return documents.reduce((acc, document) => {
    const id = document.food_truck_id?.toString();
    if (!id || acc[id]) return acc;

    const grade = getSanitationGradeFromDocument(document);
    if (grade) {
      acc[id] = grade;
    }
    return acc;
  }, {});
};

const calculateComplianceSummary = async (foodTruckOrId) => {
  const foodTruck =
    typeof foodTruckOrId === 'object' && foodTruckOrId?._id
      ? foodTruckOrId
      : await FoodTruckService.getByData(
          { _id: foodTruckOrId },
          { singleResult: true, lean: true }
        );

  if (!foodTruck) {
    throw buildComplianceError('Food truck not found', 404);
  }

  const now = new Date();
  await archiveExpiredDocuments({ foodTruckId: foodTruck._id, now });
  const documents = await getCurrentDocuments(foodTruck._id);
  const latestByType = selectLatestByType(documents);
  const sanitationGradeDocument = getLatestProvidedSanitationGradeDocument(documents, now);
  const sanitationGrade = getSanitationGradeFromDocument(sanitationGradeDocument);
  const sanitationGradeEligible = isSanitationGradeEligible(sanitationGrade);
  const sanitationGradeBlocked = !!sanitationGrade && !sanitationGradeEligible;
  const hasSsnOnProfile =
    hasValidTaxIdentifier(foodTruck.ssn) ||
    hasMaskedTaxIdentifier(foodTruck.ssn) ||
    hasEncryptedTaxIdentifier(foodTruck, 'SSN');
  const selectedTaxIdentifierType =
    String(foodTruck.tax_identifier_type || '').toUpperCase() === 'SSN' ||
    hasSsnOnProfile
      ? 'SSN'
      : 'EIN';
  const grandfathered = isGrandfatheredVendor(foodTruck);
  const complianceRequirements = getComplianceRequirements();
  const totalScoreWeight = complianceRequirements.reduce(
    (total, requirement) => total + Number(requirement.scoreWeight || 0),
    0
  );
  let score = 0;
  const missingRequirements = [];
  const expiringRequirements = [];
  const pendingRequirements = [];
  const rejectedRequirements = [];

  const requirements = complianceRequirements.map((requirement) => {
    const document = latestByType[requirement.type] || null;
    const tracksExpiration = requirement.type !== 'HEALTH_PERMIT';
    const days_until_expiration = tracksExpiration
      ? getDaysUntil(document?.expiration_date, now)
      : null;
    const verified = isVerifiedActiveDocument(document, now);
    const expired = days_until_expiration !== null && days_until_expiration < 0;
    const isOptionalDocument = !requirement.required;
    const profileTaxIdentifierVerified = false;
    let status = 'missing';

    if (profileTaxIdentifierVerified) {
      status = 'verified';
      score += requirement.scoreWeight;
    } else if (verified) {
      status = 'verified';
      score += requirement.scoreWeight;
    } else if (['pending_review', 'manual_review', 'revalidation_needed'].includes(document?.review_status)) {
      status = document.review_status;
      pendingRequirements.push(requirement.type);
    } else if (document?.review_status === 'rejected') {
      status = 'rejected';
      if (!isOptionalDocument) {
        rejectedRequirements.push(requirement.type);
      }
    } else if (document?.review_status === 'expired' || expired) {
      status = 'expired';
    } else if (isOptionalDocument) {
      status = document ? 'uploaded' : 'optional';
    }

    if (
      !isOptionalDocument &&
      (!document || !verified)
    ) {
      missingRequirements.push(requirement.type);
    }

    if (verified && days_until_expiration !== null && days_until_expiration <= 30) {
      expiringRequirements.push(requirement.type);
    }

    const accessUrl = document?.file_key
      ? getSignedObjectUrl(document.file_key)
      : document?.file_url || null;

    return {
      ...requirement,
      status,
      document: document
        ? {
            ...document,
            access_url: accessUrl,
          }
        : null,
      days_until_expiration,
    };
  });

  if (selectedTaxIdentifierType === 'SSN' && !hasSsnOnProfile) {
    missingRequirements.push('SSN_PROFILE');
  }

  const externalProvider = selectedTaxIdentifierType === 'SSN' ? 'COMPLYCUBE' : 'COBALT';
  const requiredExternalChecks = selectedTaxIdentifierType === 'SSN'
    ? ['SSN']
    : ['TIN', 'SOS'];
  const externalRecords = await VendorComplianceProviderVerificationModel.find({
    food_truck_id: foodTruck._id,
    verification_cycle: getVerificationCycle(foodTruck),
    provider: externalProvider,
    check_type: { $in: requiredExternalChecks },
  }).lean();
  const externalByType = Object.fromEntries(
    (externalRecords || []).map((record) => [record.check_type, record])
  );
  const externalPassed = requiredExternalChecks.every(
    (checkType) => externalByType[checkType]?.status === 'PASSED'
  );
  const externalStatuses = externalRecords.map((record) => record.status);
  const externalStatus = externalPassed ? 'PASSED'
    : externalStatuses.includes('PENDING') ? 'PENDING'
      : externalStatuses.includes('RETRYABLE_ERROR') ? 'RETRYABLE_ERROR'
        : externalStatuses.includes('MANUAL_REVIEW') ? 'MANUAL_REVIEW'
          : externalStatuses.includes('FAILED') ? 'FAILED'
            : 'NOT_STARTED';
  const businessLicenseVerified = isVerifiedActiveDocument(latestByType.BUSINESS_LICENSE, now);
  const w9Verified = isVerifiedActiveDocument(latestByType.W9, now);
  const driverLicenseVerified = isVerifiedActiveDocument(
    latestByType[CORE_IDENTITY_DOCUMENT_TYPE],
    now
  );
  const coreComponents = [
    { type: 'BUSINESS_LICENSE', label: 'Business License / Permit', verified: businessLicenseVerified },
    { type: 'W9', label: 'Completed W-9', verified: w9Verified },
    { type: CORE_IDENTITY_DOCUMENT_TYPE, label: 'Driver License Front', verified: driverLicenseVerified },
  ];
  if (selectedTaxIdentifierType === 'SSN') {
    coreComponents.push({
      type: 'EXTERNAL_IDENTITY_VERIFICATION',
      label: 'ComplyCube identity verification',
      verified: externalPassed,
    });
  } else {
    coreComponents.push(
      { type: 'COBALT_TIN', label: 'EIN verification', verified: externalByType.TIN?.status === 'PASSED' },
      { type: 'COBALT_SOS', label: 'State verification', verified: externalByType.SOS?.status === 'PASSED' },
    );
  }
  const coreComponentWeight = 100 / coreComponents.length;
  score = Number(coreComponents.reduce(
    (total, component) => total + (component.verified ? coreComponentWeight : 0),
    0
  ).toFixed(2));
  coreComponents.filter((component) => !component.verified).forEach((component) => {
    if (!missingRequirements.includes(component.type)) missingRequirements.push(component.type);
  });
  const internalCoreCompliant = coreComponents
    .filter((component) => !['EXTERNAL_IDENTITY_VERIFICATION', 'COBALT_TIN', 'COBALT_SOS'].includes(component.type))
    .every((component) => component.verified) &&
    rejectedRequirements.length === 0 && pendingRequirements.length === 0;
  const coreCompliant = internalCoreCompliant && externalPassed;
  const hasValidCoi = isVerifiedActiveDocument(latestByType.COI, now);
  const eligible = coreCompliant;
  const hasPendingReview = pendingRequirements.length > 0 || externalRecords.some(
    (record) => record.status === 'PENDING'
  );
  const scoreBand = getScoreBand({ score, eligible, hasPendingReview });
  const complianceMessage = eligible
    ? 'Vendor core compliance is complete.'
    : `Vendor compliance must be completed. Contact support at ${SUPPORT_PHONE_NUMBER} if you need help.`;

  return {
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    score,
    score_color: scoreBand.color,
    score_color_hex: scoreBand.hex,
    score_label: scoreBand.label,
    eligible,
    core_compliant: coreCompliant,
    internal_core_compliant: internalCoreCompliant,
    event_eligible: coreCompliant && hasValidCoi,
    external_verification: {
      provider: externalProvider,
      status: externalStatus,
      checks: externalRecords,
    },
    core_components: coreComponents.map((component) => ({ ...component, weight: coreComponentWeight })),
    sanitation_grade: sanitationGrade,
    sanitation_grade_eligible: sanitationGradeEligible,
    sanitation_grade_blocked: sanitationGradeBlocked,
    grandfathered,
    grandfather_cutoff_date: GRANDFATHER_CUTOFF_DATE,
    can_bid: coreCompliant && hasValidCoi,
    can_open_accepting_orders: eligible,
    support_phone_number: SUPPORT_PHONE_NUMBER,
    message: complianceMessage,
    requirements,
    missing_requirements: missingRequirements,
    expiring_requirements: expiringRequirements,
    pending_requirements: pendingRequirements,
    rejected_requirements: rejectedRequirements,
  };
};

const assertEligible = async (foodTruckOrId, actionLabel = 'continue') => {
  const summary = await calculateComplianceSummary(foodTruckOrId);
  const isOpenAcceptingOrdersAction = /open|accept orders/i.test(actionLabel);
  const isBlocked = isOpenAcceptingOrdersAction
    ? !summary.can_open_accepting_orders
    : !summary.eligible || !summary.can_bid;

  if (isBlocked) {
    throw buildComplianceError(
      summary.message || `Compliance must be complete before vendors can ${actionLabel}.`,
      409,
      summary
    );
  }
  return summary;
};

const getDocumentBusinessNames = (document = {}) => {
  const fields = document.extracted_fields || {};
  return [
    fields.legal_business_name,
    fields.business_name,
    fields.taxpayer_name,
    fields.name,
    fields.insured_name,
  ].filter((value) => value !== undefined && value !== null && value !== '');
};

// Tax identifiers are deliberately never retained in OCR metadata. A tax-ID
// edit requires a fresh W-9/tax-proof scan. A legal-name or DBA correction
// revalidates every active identity document so each OCR comparison is tied to
// the current vendor profile.
const beginProfileRevalidation = async ({ foodTruck, actor = null, previousIdentity = {} }) => {
  const currentIdentity = {
    legal_business_name: foodTruck.legal_business_name || null,
    dba: foodTruck.dba || null,
    tax_identifier_type: foodTruck.tax_identifier_type || null,
    tax_identifier_masked: foodTruck.tax_identifier_masked || null,
  };
  const taxChanged = previousIdentity.tax_identifier_type !== currentIdentity.tax_identifier_type ||
    previousIdentity.tax_identifier_masked !== currentIdentity.tax_identifier_masked;
  const nameChanged = previousIdentity.legal_business_name !== currentIdentity.legal_business_name ||
    previousIdentity.dba !== currentIdentity.dba;
  if (!taxChanged && !nameChanged) return { affected: [] };

  const documents = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruck._id,
      review_status: 'verified',
      archived_at: null,
      document_type: { $in: ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE] },
    },
    { sort: { created_at: -1 } }
  );
  const affected = [];
  const revalidationCycle = getVerificationCycle(foodTruck) + 1;
  for (const document of documents) {
    const affectsTax = document.document_type === 'W9';
    const isIdentityEvidence = ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE].includes(document.document_type);
    if ((taxChanged && affectsTax) || (nameChanged && isIdentityEvidence)) {
      document.review_status = 'revalidation_needed';
      document.ocr_status = 'revalidation_needed';
      document.revalidation_cycle = revalidationCycle;
      document.revalidation_attempt = 0;
      document.ocr_error_message = 'Profile information changed. Upload a replacement document to revalidate it.';
      document.reviewed_at = null;
      document.reviewed_by_user_id = null;
      await document.save();
      await updateLinkedFoodTruckDocumentComplianceStatus(document);
      affected.push(document.document_type);
    }
  }
  if (!affected.length) return { affected };

  foodTruck.compliance_verification_cycle = revalidationCycle;
  await foodTruck.save();
  await VendorComplianceProviderVerificationModel.updateMany(
    { food_truck_id: foodTruck._id, status: { $in: ['NOT_STARTED', 'PENDING', 'PASSED', 'RETRYABLE_ERROR'] } },
    { $set: { status: 'SUPERSEDED', completed_at: new Date() } }
  );
  await VendorComplianceAuditService.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    actor_user_id: actor?._id || null,
    actor_user_type: actor?.userType || null,
    action: 'PROFILE_REVALIDATION_REQUIRED',
    notes: 'Profile correction requires replacement compliance evidence.',
    metadata: { affected_document_types: [...new Set(affected)] },
  });
  return { affected: [...new Set(affected)] };
};

// Provider calls are deliberately deferred until the three internal core
// documents have passed their own OCR comparisons. This is idempotent: the
// adapter reuses the active record for the current verification cycle.
const startExternalVerificationWhenInternalChecksPass = async (foodTruckId, { checkType = null } = {}) => {
  const foodTruck = await FoodTruckModel.findById(foodTruckId)
    .select('+tax_identifier_encrypted tax_identifier_type tax_identifier_masked legal_business_name dba name legal_business_type business_registration_state compliance_verification_cycle userId')
    .exec();
  if (!foodTruck) return null;

  const documents = await getCurrentDocuments(foodTruck._id);
  const latestByType = {};
  for (const document of documents || []) {
    if (!latestByType[document.document_type]) latestByType[document.document_type] = document;
  }
  const internalChecksPass = ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE]
    .every((documentType) => isVerifiedActiveDocument(latestByType[documentType]));
  if (!internalChecksPass) return null;

  const ProviderHelper = require('../../helper/vendor-compliance-provider-helper');
  if (!ProviderHelper.enabled()) return null;
  try {
    return String(foodTruck.tax_identifier_type || '').toUpperCase() === 'SSN'
      ? await ProviderHelper.startComplyCubeSsnCheck(foodTruck)
      : await ProviderHelper.startCobaltEinChecks(foodTruck, { checkType });
  } catch (error) {
    const provider = String(foodTruck.tax_identifier_type || '').toUpperCase() === 'SSN'
      ? 'COMPLYCUBE'
      : 'COBALT';
    const checkTypes = provider === 'COMPLYCUBE' ? ['SSN'] : ['TIN', 'SOS'];
    await Promise.all(checkTypes.map((checkType) =>
      VendorComplianceProviderVerificationModel.findOneAndUpdate(
        {
          food_truck_id: foodTruck._id,
          verification_cycle: getVerificationCycle(foodTruck),
          provider,
          check_type: checkType,
        },
        {
          $set: {
            vendor_user_id: foodTruck.userId,
            status: 'RETRYABLE_ERROR',
            safe_reason: 'Provider verification could not be started. Retry is required.',
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      )
    ));
    return null;
  }
};

const isDocumentAttachedToMarketplace = async (document) => {
  if (!document?.file_url && !document?.file_key) return false;

  const attachmentQuery = {
    status: { $ne: 'DELETED' },
    $or: [
      ...(document.file_url ? [{ file_url: document.file_url }] : []),
      ...(document.file_key ? [{ file_key: document.file_key }] : []),
    ],
  };

  const count = await MarketplaceAttachmentService.getCount(attachmentQuery);
  return Number(count || 0) > 0;
};

const removeLinkedFoodTruckDocuments = async (complianceDocument) => {
  if (!complianceDocument?.food_truck_id) return false;

  const foodTruck = await FoodTruckService.getByData(
    { _id: complianceDocument.food_truck_id },
    { singleResult: true }
  );
  if (!foodTruck) return false;

  const originalCount = (foodTruck.documents || []).length;
  foodTruck.documents = (foodTruck.documents || []).filter((legacyDocument) => {
    const matches =
      legacyDocument.compliance_document_id === complianceDocument.document_id ||
      legacyDocument.file_url === complianceDocument.file_url ||
      (legacyDocument.file_key &&
        complianceDocument.file_key &&
        legacyDocument.file_key === complianceDocument.file_key);
    return !matches;
  });

  if (foodTruck.documents.length !== originalCount) {
    await foodTruck.save();
    return true;
  }

  return false;
};

const deleteUnverifiedDocument = async ({
  document,
  actorUserId,
  reason,
  replacedByDocumentId,
}) => {
  const attachedToMarketplace = await isDocumentAttachedToMarketplace(document);
  if (attachedToMarketplace) {
    return archiveComplianceDocumentRecord({
      document,
      user: { _id: actorUserId, userType: 'SYSTEM' },
      reason,
      replacedByDocumentId,
      action: 'ARCHIVE_ATTACHED_REPLACED',
    });
  }

  await removeLinkedFoodTruckDocuments(document);
  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: document.food_truck_id,
    vendor_user_id: document.vendor_user_id,
    action: 'DELETE_UNVERIFIED_REPLACED',
    actor_user_id: actorUserId,
    actor_user_type: 'SYSTEM',
    notes: reason,
    metadata: {
      document_type: document.document_type,
      replaced_by_document_id: replacedByDocumentId || null,
    },
  });
  await VendorComplianceDocumentService.destroy({ document_id: document.document_id });
  if (document.file_key) await removeObject(document.file_key);
  return document;
};

const archiveComplianceDocumentRecord = async ({
  document,
  user = null,
  reason,
  replacedByDocumentId = null,
  action = 'ADMIN_ARCHIVE',
}) => {
  if (document.archived_at || document.review_status === 'archived') {
    return document;
  }

  document.review_status = 'archived';
  document.archived_at = new Date();
  document.archived_reason = reason || 'Archived by administrator';
  document.archived_by_user_id = user?._id || null;
  document.replaced_by_document_id = replacedByDocumentId || null;
  await document.save();
  await updateLinkedFoodTruckDocumentComplianceStatus(document);

  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: document.food_truck_id,
    vendor_user_id: document.vendor_user_id,
    action,
    actor_user_id: user?._id || null,
    actor_user_type: user?.userType || 'SYSTEM',
    notes: document.archived_reason,
    metadata: {
      document_type: document.document_type,
      replaced_by_document_id: replacedByDocumentId || null,
    },
  });

  return document;
};

const deleteRejectedDocument = async ({ document, user, reason }) => {
  const attachedToMarketplace = await isDocumentAttachedToMarketplace(document);
  if (document.review_status === 'verified' || attachedToMarketplace) {
    return archiveComplianceDocumentRecord({
      document,
      user,
      reason,
      action: document.review_status === 'verified'
        ? 'REVIEW_VERIFIED_ARCHIVED'
        : 'REVIEW_ATTACHED_ARCHIVED',
    });
  }

  await removeLinkedFoodTruckDocuments(document);
  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: document.food_truck_id,
    vendor_user_id: document.vendor_user_id,
    action: 'DELETE_REJECTED',
    actor_user_id: user?._id || null,
    actor_user_type: user?.userType || 'SYSTEM',
    notes: reason,
    metadata: { document_type: document.document_type },
  });
  await VendorComplianceDocumentService.destroy({ document_id: document.document_id });
  if (document.file_key) await removeObject(document.file_key);
  return document;
};

const purgeRejectedDocuments = async ({
  user = null,
  reason = 'Rejected compliance document cleanup',
} = {}) => {
  const rejectedDocuments = await VendorComplianceDocumentService.getByData(
    { review_status: 'rejected' },
    {}
  );

  let purgedCount = 0;
  for (const document of rejectedDocuments || []) {
    await deleteRejectedDocument({
      document,
      user: user || { _id: null, userType: 'SYSTEM' },
      reason,
    });
    purgedCount += 1;
  }

  return purgedCount;
};

const retainOrDeleteExistingDocument = async ({
  foodTruckId,
  documentType,
  actorUserId,
  replacedByDocumentId,
  reason = 'Replaced by newer compliance document',
}) => {
  const existingDocuments = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruckId,
      document_type: documentType,
      ...(replacedByDocumentId
        ? { document_id: { $ne: replacedByDocumentId } }
        : {}),
      review_status: { $ne: 'archived' },
      archived_at: null,
    },
    {}
  );

  await Promise.all(
    existingDocuments.map(async (document) => {
      if (document.review_status !== 'verified') {
        await deleteUnverifiedDocument({
          document,
          actorUserId,
          reason,
          replacedByDocumentId,
        });
        return;
      }
      await archiveComplianceDocumentRecord({
        document,
        user: { _id: actorUserId, userType: 'SYSTEM' },
        reason,
        replacedByDocumentId,
        action: 'ARCHIVE_REPLACED',
      });
    })
  );
};

const reconcileActiveComplianceDocuments = async ({ foodTruckId = null } = {}) => {
  const documents = await VendorComplianceDocumentService.getByData(
    {
      ...(foodTruckId ? { food_truck_id: foodTruckId } : {}),
      review_status: { $ne: 'archived' },
      archived_at: null,
    },
    { sort: { created_at: -1 } }
  );
  const newestByKey = new Map();
  for (const document of documents || []) {
    const key = `${document.food_truck_id}:${document.document_type}`;
    if (!newestByKey.has(key)) {
      newestByKey.set(key, document);
      continue;
    }
    const newest = newestByKey.get(key);
    if (document.review_status !== 'verified') {
      await deleteUnverifiedDocument({
        document,
        actorUserId: newest.uploaded_by_user_id,
        reason: 'Unverified duplicate replaced by newer compliance document',
        replacedByDocumentId: newest.document_id,
      });
      continue;
    }
    await archiveComplianceDocumentRecord({
      document,
      user: { _id: newest.uploaded_by_user_id, userType: 'SYSTEM' },
      reason: 'Replaced by newer compliance document',
      replacedByDocumentId: newest.document_id,
      action: 'ARCHIVE_RECONCILED_DUPLICATE',
    });
  }
};

const uploadComplianceDocument = async ({
  foodTruck,
  file,
  body,
  user,
  fileUrl,
  fileKey,
}) => {
  const documentType = normalizeComplianceDocumentType(body.document_type);
  const requirement = getComplianceRequirement(documentType);

  if (!requirement) {
    throw buildComplianceError('Unsupported compliance document type', 400);
  }

  const existingCount = await VendorComplianceDocumentService.getCount({
    food_truck_id: foodTruck._id,
    document_type: documentType,
  });
  const revalidationAttempt = await VendorComplianceDocumentService.getCount({
    food_truck_id: foodTruck._id,
    document_type: documentType,
    revalidation_cycle: getVerificationCycle(foodTruck),
    ocr_status: 'revalidation_needed',
  });

  const isSanitationGrade = documentType === 'HEALTH_PERMIT';
  const automatedCoreDocument = ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE].includes(documentType);
  const adminRequestedPendingReview =
    user.userType === 'SUPER_ADMIN' && body.review_status === 'pending_review';
  const vendorEnteredIssueDate = asDate(body.issue_date);
  const vendorEnteredExpirationDate = isSanitationGrade
    ? null
    : asDate(body.expiration_date);
  const document = await VendorComplianceDocumentService.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    document_type: documentType,
    version: Number(existingCount || 0) + 1,
    revalidation_cycle: getVerificationCycle(foodTruck),
    revalidation_attempt: Number(revalidationAttempt || 0),
    title: body.title || requirement.label,
    file_url: fileUrl,
    file_key: fileKey,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    issue_date: vendorEnteredIssueDate,
    vendor_entered_issue_date: vendorEnteredIssueDate,
    expiration_date: vendorEnteredExpirationDate,
    vendor_entered_expiration_date: vendorEnteredExpirationDate,
    extracted_fields: {},
    uploaded_by_user_id: user._id,
    review_status:
      user.userType === 'SUPER_ADMIN' && !adminRequestedPendingReview && !automatedCoreDocument
        ? 'verified'
        : 'pending_review',
    reviewed_by_user_id:
      user.userType === 'SUPER_ADMIN' && !adminRequestedPendingReview && !automatedCoreDocument
        ? user._id
        : null,
    reviewed_at:
      user.userType === 'SUPER_ADMIN' && !adminRequestedPendingReview && !automatedCoreDocument
        ? new Date()
        : null,
    ocr_status: user.userType === 'SUPER_ADMIN' && !automatedCoreDocument ? 'not_configured' : undefined,
  });

  const manualSanitationGrade = getManualSanitationGrade(body);
  if (documentType === 'HEALTH_PERMIT' && manualSanitationGrade) {
    document.extracted_fields = {
      ...(document.extracted_fields || {}),
      manual_sanitation_grade: manualSanitationGrade,
      sanitation_grade: manualSanitationGrade,
    };
    await document.save();
  }

  await retainOrDeleteExistingDocument({
    foodTruckId: foodTruck._id,
    documentType,
    actorUserId: user._id,
    replacedByDocumentId: document.document_id,
  });

  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    action: 'UPLOAD',
    actor_user_id: user._id,
    actor_user_type: user.userType,
    metadata: { document_type: documentType },
  });

  return VendorComplianceDocumentService.getByData(
    { document_id: document.document_id },
    { singleResult: true, lean: true }
  );
};

const createSignedW9Document = async ({ foodTruck, user, envelopeId, pdfBuffer }) => {
  const requirement = getComplianceRequirement('W9');
  const { url, key } = await addObjectFromBufferWithKey(
    { buffer: pdfBuffer, originalname: `signed-w9-${envelopeId}.pdf`, mimetype: 'application/pdf' },
    `vendor-compliance/${foodTruck._id}/W9`
  );
  const existingCount = await VendorComplianceDocumentService.getCount({
    food_truck_id: foodTruck._id,
    document_type: 'W9',
  });
  const revalidationAttempt = await VendorComplianceDocumentService.getCount({
    food_truck_id: foodTruck._id,
    document_type: 'W9',
    revalidation_cycle: getVerificationCycle(foodTruck),
    ocr_status: 'revalidation_needed',
  });
  const document = await VendorComplianceDocumentService.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    document_type: 'W9',
    version: Number(existingCount || 0) + 1,
    revalidation_cycle: getVerificationCycle(foodTruck),
    revalidation_attempt: Number(revalidationAttempt || 0),
    title: 'Signed W-9',
    file_url: url,
    file_key: key,
    original_name: 'signed-w9.pdf',
    mime_type: 'application/pdf',
    size_bytes: pdfBuffer.length,
    extracted_fields: { docusign_envelope_id: envelopeId },
    uploaded_by_user_id: user._id,
    review_status: 'pending_review',
  });
  const ocrResult = await enqueueComplianceOcr({ document, requirement });
  Object.assign(document, ocrResult);
  await document.save();
  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    action: 'DOCUSIGN_W9_COMPLETED',
    actor_user_id: user._id,
    actor_user_type: user.userType,
    metadata: { document_type: 'W9', envelope_id: envelopeId },
  });
  return document;
};

const syncLegacyFoodTruckDocuments = async ({ foodTruckId = null } = {}) => {
  const query = foodTruckId ? { _id: foodTruckId } : {};
  const foodTrucks = await FoodTruckService.getByData(query);
  let createdCount = 0;

  for (const foodTruck of foodTrucks || []) {
    if (!foodTruck?._id || !foodTruck?.userId) continue;
    let foodTruckChanged = false;

    const newestLegacyByType = new Map();
    for (const legacyDocument of foodTruck.documents || []) {
      const status = String(
        legacyDocument?.compliance_status ||
          legacyDocument?.compliance_review_status ||
          legacyDocument?.document_status ||
          ''
      ).toUpperCase();
      if (!legacyDocument?.file_url || ['ARCHIVED', 'REJECTED', 'DELETED'].includes(status)) continue;
      const type = normalizeComplianceDocumentType(legacyDocument.document_type);
      const existing = newestLegacyByType.get(type);
      const uploadedAt = new Date(legacyDocument.uploaded_at || 0).getTime();
      const existingUploadedAt = new Date(existing?.uploaded_at || 0).getTime();
      if (!existing || uploadedAt >= existingUploadedAt) newestLegacyByType.set(type, legacyDocument);
    }

    foodTruck.documents = (foodTruck.documents || []).filter((legacyDocument) => {
      if (!legacyDocument?.file_url) return true;
      const type = normalizeComplianceDocumentType(legacyDocument.document_type);
      const newest = newestLegacyByType.get(type);
      if (!newest || newest === legacyDocument) return true;
      const verified =
        String(
          legacyDocument.compliance_status ||
            legacyDocument.compliance_review_status ||
            ''
        ).toUpperCase() === 'VERIFIED';
      foodTruckChanged = true;
      if (!verified) return false;
      legacyDocument.document_status = 'ARCHIVED';
      legacyDocument.compliance_status = 'ARCHIVED';
      legacyDocument.archived_at = new Date();
      return true;
    });

    for (const legacyDocument of foodTruck.documents || []) {
      const legacyComplianceStatus = String(
        legacyDocument?.compliance_status ||
          legacyDocument?.compliance_review_status ||
          legacyDocument?.document_status ||
          ''
      ).toUpperCase();
      if (
        !legacyDocument?.file_url ||
        ['ARCHIVED', 'REJECTED', 'DELETED'].includes(legacyComplianceStatus)
      ) {
        continue;
      }

      const documentType = normalizeComplianceDocumentType(
        legacyDocument.document_type
      );
      const requirement = getComplianceRequirement(documentType);
      if (!requirement) {
        foodTruckChanged =
          applyComplianceStatusToFoodTruckDocument(legacyDocument, null) ||
          foodTruckChanged;
        continue;
      }

      const existing = await VendorComplianceDocumentService.getByData(
        {
          food_truck_id: foodTruck._id,
          document_type: documentType,
          review_status: { $ne: 'archived' },
          archived_at: null,
          $or: [
            { file_url: legacyDocument.file_url },
            ...(legacyDocument.file_key
              ? [{ file_key: legacyDocument.file_key }]
              : []),
          ],
        },
        { singleResult: true, lean: true }
      );
      if (existing) {
        foodTruckChanged =
          applyComplianceStatusToFoodTruckDocument(legacyDocument, existing) ||
          foodTruckChanged;
        continue;
      }

      const existingCount = await VendorComplianceDocumentService.getCount({
        food_truck_id: foodTruck._id,
        document_type: documentType,
      });
      const document = await VendorComplianceDocumentService.create({
        food_truck_id: foodTruck._id,
        vendor_user_id: foodTruck.userId,
        document_type: documentType,
        version: Number(existingCount || 0) + 1,
        revalidation_cycle: getVerificationCycle(foodTruck),
        title: legacyDocument.title || requirement.label,
        file_url: legacyDocument.file_url,
        file_key: legacyDocument.file_key || null,
        original_name: legacyDocument.original_name || null,
        mime_type: legacyDocument.mime_type || null,
        size_bytes: legacyDocument.size_bytes || null,
        uploaded_by_user_id:
          legacyDocument.uploaded_by_user_id || foodTruck.userId,
        review_status: 'pending_review',
        ocr_status: 'not_configured',
      });

      await VendorComplianceAuditService.create({
        document_id: document.document_id,
        food_truck_id: foodTruck._id,
        vendor_user_id: foodTruck.userId,
        action: 'UPLOAD',
        actor_user_id: legacyDocument.uploaded_by_user_id || foodTruck.userId,
        actor_user_type: 'VENDOR',
        notes: 'Imported from vendor document record',
        metadata: { document_type: documentType, source: 'food_truck.documents' },
      });
      foodTruckChanged =
        applyComplianceStatusToFoodTruckDocument(legacyDocument, document) ||
        foodTruckChanged;
      createdCount += 1;
    }

    if (foodTruckChanged) {
      await foodTruck.save();
    }
  }

  return createdCount;
};

const submitComplianceDocumentsForOcr = async ({ foodTruck, user, documentTypes = [] }) => {
  const documents = await VendorComplianceDocumentService.getByData(
    {
      food_truck_id: foodTruck._id,
      review_status: { $ne: 'archived' },
      archived_at: null,
    },
    { sort: { created_at: -1 } }
  );
  const latestByType = selectNewestByType(documents);
  const submittedDocuments = [];
  const requestedDocumentTypes = new Set(
    (Array.isArray(documentTypes) ? documentTypes : [])
      .map(normalizeComplianceDocumentType)
      .filter((type) => getComplianceRequirement(type))
  );
  const isExplicitDocumentRetry = requestedDocumentTypes.size > 0;

  for (const document of Object.values(latestByType)) {
    const requirement = getComplianceRequirement(document.document_type);
    if (!requirement) continue;
    if (isExplicitDocumentRetry && !requestedDocumentTypes.has(document.document_type)) {
      continue;
    }

    // The normal save action submits only newly uploaded/failed documents.
    // A completed or verified document stays untouched unless the vendor
    // explicitly retries that individual document.
    if (!isExplicitDocumentRetry && document.ocr_status !== 'not_configured') {
      continue;
    }

    const ocrRequestAgeMs = document.ocr_requested_at
      ? Date.now() - new Date(document.ocr_requested_at).getTime()
      : Number.POSITIVE_INFINITY;
    // A normal OCR request completes through the Function callback quickly.
    // Permit an explicit user retry for a queue record that has been stuck for
    // two minutes, while still preventing duplicate active submissions.
    const staleQueuedRequest =
      document.ocr_status === 'queued' && ocrRequestAgeMs >= 2 * 60 * 1000;
    if (['queued', 'processing'].includes(document.ocr_status) && !staleQueuedRequest) {
      submittedDocuments.push(document);
      continue;
    }

    // A document-targeted retry may resubmit a completed, revalidation, or
    // manual-review document. An active request remains protected above.
    const ocrResult = await enqueueComplianceOcr({ document, requirement });
    Object.assign(document, {
      ...ocrResult,
      review_status: 'pending_review',
      reviewed_by_user_id: null,
      reviewed_at: null,
    });
    await document.save();
    await updateLinkedFoodTruckDocumentComplianceStatus(document);

    await VendorComplianceAuditService.create({
      document_id: document.document_id,
      food_truck_id: foodTruck._id,
      vendor_user_id: foodTruck.userId,
      action: 'SUBMIT_OCR',
      actor_user_id: user._id,
      actor_user_type: user.userType,
      metadata: { document_type: document.document_type },
    });

    submittedDocuments.push(document);
  }

  return submittedDocuments;
};

const reviewComplianceDocument = async ({
  documentId,
  reviewStatus,
  reviewNotes,
  expirationDate,
  issueDate,
  extractedFields,
  user,
}) => {
  const document = await VendorComplianceDocumentService.getByData(
    { document_id: documentId },
    { singleResult: true }
  );

  if (!document) {
    throw buildComplianceError('Compliance document not found', 404);
  }

  if (document.archived_at || document.review_status === 'archived') {
    throw buildComplianceError('Archived compliance documents are read-only', 409);
  }

  if (
    reviewStatus === 'verified' &&
    ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE].includes(document.document_type)
  ) {
    throw buildComplianceError(
      'This core compliance document is verified only by the automated OCR and profile-matching workflow.',
      409
    );
  }

  if (reviewStatus === 'rejected') {
    return deleteRejectedDocument({
      document,
      user,
      reason: reviewNotes || 'Rejected by admin',
    });
  }

  document.review_status = reviewStatus;
  document.review_notes = reviewNotes || null;
  document.reviewed_by_user_id = user._id;
  document.reviewed_at = new Date();
  if (expirationDate !== undefined) {
    document.expiration_date = asDate(expirationDate);
  }
  if (issueDate !== undefined) {
    document.issue_date = asDate(issueDate);
  }
  if (extractedFields && typeof extractedFields === 'object') {
    document.extracted_fields = {
      ...(document.extracted_fields || {}),
      ...extractedFields,
    };
  }
  if (document.document_type === 'HEALTH_PERMIT') {
    document.expiration_date = null;
    document.vendor_entered_expiration_date = null;
    const sanitationGrade = getSanitationGradeFromDocument(document);
    if (sanitationGrade) {
      document.extracted_fields = {
        ...(document.extracted_fields || {}),
        sanitation_grade: sanitationGrade,
      };
    } else if (reviewStatus === 'verified') {
      throw buildComplianceError(
        'Sanitation grade must be verified before approving this document.',
        400
      );
    }
  }
  await document.save();
  await updateLinkedFoodTruckDocumentComplianceStatus(document);

  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: document.food_truck_id,
    vendor_user_id: document.vendor_user_id,
    action: `REVIEW_${String(reviewStatus || '').toUpperCase()}`,
    actor_user_id: user._id,
    actor_user_type: user.userType,
    notes: reviewNotes || null,
  });

  return document;
};

const updateComplianceDocumentDates = async ({
  documentId,
  expirationDate,
  issueDate,
  user,
}) => {
  const document = await VendorComplianceDocumentService.getByData(
    { document_id: documentId },
    { singleResult: true }
  );

  if (!document) {
    throw buildComplianceError('Compliance document not found', 404);
  }

  if (document.archived_at || document.review_status === 'archived') {
    throw buildComplianceError('Archived compliance documents are read-only', 409);
  }

  if (issueDate !== undefined) {
    document.issue_date = asDate(issueDate);
  }
  if (document.document_type === 'HEALTH_PERMIT') {
    document.expiration_date = null;
    document.vendor_entered_expiration_date = null;
  } else if (expirationDate !== undefined) {
    document.expiration_date = asDate(expirationDate);
  }

  await document.save();
  await updateLinkedFoodTruckDocumentComplianceStatus(document);
  await VendorComplianceAuditService.create({
    document_id: document.document_id,
    food_truck_id: document.food_truck_id,
    vendor_user_id: document.vendor_user_id,
    action: 'ADMIN_UPDATE_DATES',
    actor_user_id: user._id,
    actor_user_type: user.userType,
    metadata: {
      issue_date: getDateKey(document.issue_date),
      expiration_date: getDateKey(document.expiration_date),
    },
  });

  return document;
};

const archiveComplianceDocument = async ({ documentId, reason, user }) => {
  const document = await VendorComplianceDocumentService.getByData(
    { document_id: documentId },
    { singleResult: true }
  );

  if (!document) {
    throw buildComplianceError('Compliance document not found', 404);
  }

  if (document.archived_at || document.review_status === 'archived') {
    return document;
  }

  return archiveComplianceDocumentRecord({
    document,
    user,
    reason: reason || 'Archived by RTC administrator',
    action: 'ADMIN_ARCHIVE',
  });
};

const applyOcrResult = async ({ documentId, ocrStatus, extractedFields, errorMessage }) => {
  const document = await VendorComplianceDocumentService.getByData(
    { document_id: documentId },
    { singleResult: true }
  );

  if (!document) {
    throw buildComplianceError('Compliance document not found', 404);
  }

  const normalizedExtractedFields = {
    ...(document.extracted_fields || {}),
    ...(extractedFields || {}),
  };
  let automaticValidationFailure = null;
  let hasSanitationGrade = false;
  if (document.document_type === 'HEALTH_PERMIT') {
    const sanitationGrade = getSanitationGradeFromFields(normalizedExtractedFields);
    if (sanitationGrade) {
      normalizedExtractedFields.sanitation_grade = sanitationGrade;
      hasSanitationGrade = true;
    } else {
      document.review_status = 'pending_review';
      document.ocr_status = 'manual_review';
      document.ocr_error_message =
        errorMessage || 'OCR could not determine the sanitation grade.';
    }
  }

  const requiresIdentityValidation = ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE]
    .includes(document.document_type);
  const foodTruck = requiresIdentityValidation
    ? await FoodTruckModel.findById(document.food_truck_id)
      .select('+tax_identifier_encrypted tax_identifier_type tax_identifier_masked legal_business_name dba name compliance_verification_cycle')
      .exec()
    : null;
  // W-9 OCR can include an EIN or SSN in raw text/word output.
  // Preserve only purpose-built comparison outcomes, never the full OCR body.
  if (document.document_type === 'W9') {
    [
      'raw_text',
      'lines',
      'words',
      'text',
      'ocr_text',
      'detected_text',
      'full_text',
    ].forEach((key) => delete normalizedExtractedFields[key]);
  }

  if (document.document_type === 'W9') {
    const extractedTaxId = getFirstFieldValue(normalizedExtractedFields, [
      'ein', 'ssn', 'tax_id', 'tax_identifier', 'taxpayer_identification_number',
    ]);
    const extractedDigits = taxDigits(extractedTaxId);
    const profileDigits = taxDigits(
      EncryptionService.decrypt(foodTruck?.tax_identifier_encrypted)
    );
    const taxIdentifierOcrOutcome = getTaxIdentifierOcrOutcome({
      extractedDigits,
      profileDigits,
    });
    const identifierMatches = taxIdentifierOcrOutcome === 'MATCHED';
    // Never retain a raw EIN/SSN in OCR metadata. The encrypted profile is
    // the system of record; only the verification outcome is persisted here.
    ['ein', 'ssn', 'tax_id', 'tax_identifier', 'taxpayer_identification_number']
      .forEach((key) => delete normalizedExtractedFields[key]);
    normalizedExtractedFields.tax_identifier_match = identifierMatches;
    normalizedExtractedFields.tax_identifier_type = foodTruck?.tax_identifier_type || null;
    normalizedExtractedFields.tax_identifier_ocr_outcome = taxIdentifierOcrOutcome;
    if (!identifierMatches) {
      if (taxIdentifierOcrOutcome === 'NOT_DETECTED') {
        automaticValidationFailure = document.document_type === 'W9'
          ? 'OCR could not read a complete nine-digit EIN or SSN from the W-9.'
          : 'OCR could not read a complete nine-digit tax ID from the W-9.';
      } else if (taxIdentifierOcrOutcome === 'PROFILE_UNAVAILABLE') {
        automaticValidationFailure = 'The vendor profile does not contain a usable encrypted tax ID for comparison.';
      } else {
        automaticValidationFailure = document.document_type === 'W9'
          ? 'OCR could not confirm that the W-9 EIN or SSN matches the vendor profile.'
          : 'OCR could not confirm that the W-9 tax ID matches the vendor profile.';
      }
    }
  }

  if (['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE].includes(document.document_type)) {
    const extractedBusinessNames = getDocumentBusinessNames({
      extracted_fields: normalizedExtractedFields,
    });
    const legalBusinessNameMatches = extractedBusinessNames.some((value) =>
      nameMatchesProfile(foodTruck, value)
    );
    normalizedExtractedFields.legal_business_name_match = legalBusinessNameMatches;
    if (!normalizedExtractedFields.legal_business_name_match) {
      automaticValidationFailure = document.document_type === 'W9'
        ? 'OCR could not confirm that the W-9 legal business name matches the vendor profile.'
        : document.document_type === CORE_IDENTITY_DOCUMENT_TYPE
          ? 'OCR could not confirm that the driver license name matches the vendor profile.'
          : 'OCR could not confirm that the business license name matches the vendor profile.';
    }
  }

  if (automaticValidationFailure) {
    applyOcrMismatchOutcome(document, automaticValidationFailure);
  }

  if (!['manual_review', 'revalidation_needed'].includes(document.ocr_status)) {
    document.ocr_status = ocrStatus || 'completed';
  }
  document.extracted_fields = normalizedExtractedFields;
  document.ocr_completed_at = new Date();
  if (document.ocr_status !== 'manual_review') {
    document.ocr_error_message = errorMessage || null;
  }
  const extractedExpirationDate = getOcrExpirationDate(extractedFields);
  const extractedIssueDate = getOcrIssueDate(extractedFields);
  const isSanitationGrade = document.document_type === 'HEALTH_PERMIT';
  const requiresIssueDate = !!getComplianceRequirement(
    document.document_type
  )?.ocrFields?.includes('issue_date');
  if (requiresIssueDate && !document.vendor_entered_issue_date && document.issue_date) {
    document.vendor_entered_issue_date = document.issue_date;
  }
  const vendorIssueKey = getDateKey(
    document.vendor_entered_issue_date || document.issue_date
  );
  const ocrIssueKey = getDateKey(extractedIssueDate);
  const issueDateMismatch =
    requiresIssueDate && vendorIssueKey && ocrIssueKey && vendorIssueKey !== ocrIssueKey;
  const missingOcrIssueDate = requiresIssueDate && vendorIssueKey && !ocrIssueKey;
  if (!document.vendor_entered_expiration_date && document.expiration_date) {
    document.vendor_entered_expiration_date = document.expiration_date;
  }
  const vendorExpirationKey = getDateKey(
    document.vendor_entered_expiration_date || document.expiration_date
  );
  const ocrExpirationKey = getDateKey(extractedExpirationDate);
  const requiresExpirationDate = !!getComplianceRequirement(
    document.document_type
  )?.ocrFields?.includes('expiration_date');
  const expirationMismatch =
    !isSanitationGrade &&
    vendorExpirationKey &&
    ocrExpirationKey &&
    vendorExpirationKey !== ocrExpirationKey;
  const missingOcrExpiration =
    requiresExpirationDate && vendorExpirationKey && !ocrExpirationKey;

  if (extractedExpirationDate && !isSanitationGrade && !expirationMismatch) {
    document.expiration_date = asDate(extractedExpirationDate);
  } else if (expirationMismatch && document.vendor_entered_expiration_date) {
    document.expiration_date = asDate(document.vendor_entered_expiration_date);
  }
  if (extractedIssueDate && requiresIssueDate && !issueDateMismatch) {
    document.issue_date = asDate(extractedIssueDate);
  } else if (issueDateMismatch && document.vendor_entered_issue_date) {
    document.issue_date = asDate(document.vendor_entered_issue_date);
  }

  if (isSanitationGrade) {
    document.expiration_date = null;
    document.vendor_entered_expiration_date = null;
  }

  if (expirationMismatch || missingOcrExpiration) {
    applyOcrMismatchOutcome(
      document,
      expirationMismatch
        ? 'OCR expiration date does not match the vendor-entered expiration date.'
        : 'OCR could not confirm the vendor-entered expiration date.'
    );
  }
  if (issueDateMismatch || missingOcrIssueDate) {
    applyOcrMismatchOutcome(
      document,
      issueDateMismatch
        ? isSanitationGrade
          ? 'OCR inspection date does not match the vendor-entered inspection date.'
          : 'OCR issue date does not match the vendor-entered issue date.'
        : isSanitationGrade
          ? 'OCR could not confirm the vendor-entered inspection date.'
          : 'OCR could not confirm the vendor-entered issue date.'
    );
  }
  if (
    document.document_type === 'HEALTH_PERMIT' &&
    hasSanitationGrade &&
    document.ocr_status === 'completed'
  ) {
    document.review_status = 'verified';
    document.reviewed_by_user_id = null;
    document.reviewed_at = new Date();
  }
  const coreIdentityDocument = ['BUSINESS_LICENSE', 'W9', CORE_IDENTITY_DOCUMENT_TYPE]
    .includes(document.document_type);
  const datesValidated = !expirationMismatch && !missingOcrExpiration &&
    !issueDateMismatch && !missingOcrIssueDate;
  if (
    !isSanitationGrade &&
    !automaticValidationFailure &&
    datesValidated &&
    document.ocr_status === 'completed'
  ) {
    document.review_status = 'verified';
    document.reviewed_by_user_id = null;
    document.reviewed_at = new Date();
  }
  await document.save();
  await updateLinkedFoodTruckDocumentComplianceStatus(document);
  // External verification is intentionally user-initiated from the explicit
  // Verification action. OCR callbacks only establish the internal gate.
  return document;
};

const archiveExpiredDocuments = async ({ foodTruckId = null, now = new Date() } = {}) => {
  const expiredDocuments = await VendorComplianceDocumentService.getByData(
    {
      ...(foodTruckId ? { food_truck_id: foodTruckId } : {}),
      document_type: { $ne: 'HEALTH_PERMIT' },
      expiration_date: { $lt: now },
      review_status: 'verified',
      archived_at: null,
    },
    {}
  );

  await Promise.all(
    expiredDocuments.map(async (document) => {
      document.review_status = 'expired';
      document.archived_at = now;
      document.archived_reason = 'Compliance document expired';
      await document.save();
      await updateLinkedFoodTruckDocumentComplianceStatus(document);
      await VendorComplianceAuditService.create({
        document_id: document.document_id,
        food_truck_id: document.food_truck_id,
        vendor_user_id: document.vendor_user_id,
        action: 'EXPIRE',
        notes: 'Document expired automatically',
      });
      await CustomNotification.sendNotificationToUsers({
        [document.vendor_user_id.toString()]: {
          title: 'Compliance paperwork required',
          body: 'Please update your compliance paperwork.',
          data: {
            activityType: 'VENDOR_COMPLIANCE_REQUIRED',
            documentId: document.document_id,
            documentType: document.document_type,
          },
        },
      });
    })
  );

  return expiredDocuments.length;
};

const sendExpirationReminders = async () => {
  const now = new Date();
  const verifiedDocuments = await VendorComplianceDocumentService.getByData(
    {
      review_status: 'verified',
      archived_at: null,
      document_type: { $ne: 'HEALTH_PERMIT' },
      expiration_date: { $ne: null },
    },
    {}
  );
  let reminderCount = 0;

  for (const document of verifiedDocuments) {
    const daysUntilExpiration = getDaysUntil(document.expiration_date, now);
    if (!REMINDER_DAYS.includes(daysUntilExpiration)) {
      continue;
    }

    if ((document.reminder_days_sent || []).includes(daysUntilExpiration)) {
      continue;
    }

    const requirement = getComplianceRequirement(document.document_type);
    await CustomNotification.sendNotificationToUsers({
      [document.vendor_user_id.toString()]: {
        title: 'Compliance document expiring',
        body:
          daysUntilExpiration === 0
            ? `${requirement?.label || 'A compliance document'} expires today.`
            : `${requirement?.label || 'A compliance document'} expires in ${daysUntilExpiration} days.`,
        data: {
          activityType: 'VENDOR_COMPLIANCE_EXPIRATION',
          documentId: document.document_id,
          documentType: document.document_type,
          daysUntilExpiration: String(daysUntilExpiration),
        },
      },
    });

    document.reminder_days_sent = [
      ...(document.reminder_days_sent || []),
      daysUntilExpiration,
    ];
    await document.save();
    await VendorComplianceAuditService.create({
      document_id: document.document_id,
      food_truck_id: document.food_truck_id,
      vendor_user_id: document.vendor_user_id,
      action: 'EXPIRATION_REMINDER',
      notes: `${daysUntilExpiration} day reminder sent`,
      metadata: { days_until_expiration: daysUntilExpiration },
    });
    reminderCount += 1;
  }

  return reminderCount;
};

const runComplianceMaintenance = async () => {
  const reminders_sent = await sendExpirationReminders();
  const archived_count = await archiveExpiredDocuments();
  const ProviderHelper = require('../../helper/vendor-compliance-provider-helper');
  const cobalt_sos_checks_polled = await ProviderHelper.pollPendingCobaltSosChecks();
  return { reminders_sent, archived_count, cobalt_sos_checks_polled };
};

module.exports = {
  REMINDER_DAYS,
  calculateComplianceSummary,
  assertEligible,
  beginProfileRevalidation,
  startExternalVerificationWhenInternalChecksPass,
  getSanitationGradeMap,
  getSanitationGradeFromFields,
  taxDigits,
  getTaxIdentifierOcrOutcome,
  getDocumentBusinessNames,
  nameMatchesProfile,
  uploadComplianceDocument,
  createSignedW9Document,
  reconcileActiveComplianceDocuments,
  syncLegacyFoodTruckDocuments,
  submitComplianceDocumentsForOcr,
  reviewComplianceDocument,
  updateComplianceDocumentDates,
  archiveComplianceDocument,
  purgeRejectedDocuments,
  applyOcrResult,
  getOcrMismatchOutcome,
  sendExpirationReminders,
  archiveExpiredDocuments,
  runComplianceMaintenance,
};
