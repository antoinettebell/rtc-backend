const {
  FoodTruckService,
  VendorComplianceDocumentService,
  VendorComplianceAuditService,
} = require('./index');
const {
  SUPPORT_PHONE_NUMBER,
  REMINDER_DAYS,
  getComplianceRequirement,
  getComplianceRequirements,
  normalizeComplianceDocumentType,
} = require('../../helper/vendor-compliance-config');
const { enqueueComplianceOcr } = require('../../helper/vendor-compliance-ocr-helper');
const CustomNotification = require('../../helper/custom-notification');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const buildComplianceError = (message, statusCode = 409, summary = null) => {
  const error = new Error(message);
  error.code = statusCode;
  error.compliance = summary;
  return error;
};

const asDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getDaysUntil = (date, now = new Date()) => {
  const parsed = asDate(date);
  if (!parsed) return null;
  return Math.ceil((parsed.getTime() - now.getTime()) / MS_PER_DAY);
};

const taxDigits = (value) => String(value || '').replace(/\D/g, '');

const hasValidTaxIdentifier = (value) => taxDigits(value).length === 9;
const hasEncryptedTaxIdentifier = (foodTruck, type) =>
  String(foodTruck?.tax_identifier_type || '').toUpperCase() === type &&
  !!foodTruck?.tax_identifier_masked;

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
  if (!eligible || score < 50) {
    return {
      color: 'red',
      label: 'Blocked',
      hex: '#D93025',
    };
  }

  if (score < 80) {
    return {
      color: 'yellow',
      label: 'Needs attention',
      hex: '#F9AB00',
    };
  }

  if (score < 100 || hasPendingReview) {
    return {
      color: 'blue',
      label: 'Almost complete',
      hex: '#1A73E8',
    };
  }

  return {
    color: 'green',
    label: 'Complete',
    hex: '#188038',
  };
};

const isVerifiedActiveDocument = (document, now = new Date()) => {
  if (!document || document.review_status !== 'verified' || document.archived_at) {
    return false;
  }

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
    if (!acc[document.document_type]) {
      acc[document.document_type] = document;
    }
    return acc;
  }, {});

const getLatestSanitationGradeDocument = (documents = [], now = new Date()) =>
  documents.find(
    (document) =>
      document.document_type === 'HEALTH_PERMIT' &&
      isVerifiedActiveDocument(document, now) &&
      getSanitationGradeFromFields(document.extracted_fields)
  ) || null;

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

    const grade = getSanitationGradeFromFields(document.extracted_fields);
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
  const documents = await getCurrentDocuments(foodTruck._id);
  const latestByType = selectLatestByType(documents);
  const sanitationGradeDocument = getLatestSanitationGradeDocument(documents, now);
  const sanitationGrade = getSanitationGradeFromFields(
    sanitationGradeDocument?.extracted_fields
  );
  const sanitationGradeEligible = isSanitationGradeEligible(sanitationGrade);
  const hasSsnOnProfile =
    hasValidTaxIdentifier(foodTruck.ssn) ||
    hasEncryptedTaxIdentifier(foodTruck, 'SSN');
  const hasEinOnProfile =
    hasValidTaxIdentifier(foodTruck.ein) ||
    hasEncryptedTaxIdentifier(foodTruck, 'EIN');
  const taxIdRequirementType = hasSsnOnProfile ? 'SSN' : 'EIN';
  let score = 0;
  const missingRequirements = [];
  const expiringRequirements = [];
  const pendingRequirements = [];
  const rejectedRequirements = [];

  const requirements = getComplianceRequirements().map((requirement) => {
    const document = latestByType[requirement.type] || null;
    const days_until_expiration = getDaysUntil(document?.expiration_date, now);
    const verified = isVerifiedActiveDocument(document, now);
    const expired = days_until_expiration !== null && days_until_expiration < 0;
    const isOptionalDocument = !requirement.required && requirement.scoreWeight === 0;
    const isEinDocument = requirement.type === 'EIN';
    let status = 'missing';

    if (isEinDocument && taxIdRequirementType === 'SSN') {
      status = 'not_required';
    } else if (verified) {
      status = 'verified';
      score += requirement.scoreWeight;
    } else if (document?.review_status === 'pending_review') {
      status = 'pending_review';
      if (!isOptionalDocument) {
        pendingRequirements.push(requirement.type);
      }
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
      !(isEinDocument && taxIdRequirementType === 'SSN') &&
      (!document || !verified)
    ) {
      missingRequirements.push(requirement.type);
    }

    if (verified && days_until_expiration !== null && days_until_expiration <= 30) {
      expiringRequirements.push(requirement.type);
    }

    return {
      ...requirement,
      status,
      document,
      days_until_expiration,
    };
  });

  if (taxIdRequirementType === 'SSN') {
    score += 50;
  } else if (!hasEinOnProfile) {
    missingRequirements.push('EIN_PROFILE');
  }

  score = Math.min(100, score);
  const eligible = missingRequirements.length === 0 && rejectedRequirements.length === 0;
  const hasPendingReview = pendingRequirements.length > 0;
  const scoreBand = getScoreBand({ score, eligible, hasPendingReview });
  const complianceMessage = !sanitationGradeEligible
    ? 'Please work on increasing your Sanitation Score and resubmit your Rating'
    : eligible
      ? 'Vendor compliance is eligible.'
      : `Vendor compliance must be completed before bidding or accepting orders. Contact support at ${SUPPORT_PHONE_NUMBER}.`;

  return {
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    score,
    score_color: scoreBand.color,
    score_color_hex: scoreBand.hex,
    score_label: scoreBand.label,
    eligible,
    sanitation_grade: sanitationGrade,
    sanitation_grade_eligible: sanitationGradeEligible,
    can_bid: eligible && sanitationGradeEligible,
    can_open_accepting_orders: sanitationGradeEligible,
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

const archiveExistingDocument = async ({
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
      document.review_status = 'archived';
      document.archived_at = new Date();
      document.archived_reason = reason;
      document.archived_by_user_id = actorUserId;
      document.replaced_by_document_id = replacedByDocumentId || null;
      await document.save();
    })
  );
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

  const document = await VendorComplianceDocumentService.create({
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    document_type: documentType,
    version: Number(existingCount || 0) + 1,
    title: body.title || requirement.label,
    file_url: fileUrl,
    file_key: fileKey,
    original_name: file.originalname,
    mime_type: file.mimetype,
    size_bytes: file.size,
    issue_date: asDate(body.issue_date),
    expiration_date: asDate(body.expiration_date),
    uploaded_by_user_id: user._id,
    review_status: 'pending_review',
  });

  await archiveExistingDocument({
    foodTruckId: foodTruck._id,
    documentType,
    actorUserId: user._id,
    replacedByDocumentId: document.document_id,
  });

  const ocrResult = await enqueueComplianceOcr({ document, requirement });
  await VendorComplianceDocumentService.update(
    { document_id: document.document_id },
    ocrResult
  );

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
  await document.save();

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

const applyOcrResult = async ({ documentId, ocrStatus, extractedFields, errorMessage }) => {
  const document = await VendorComplianceDocumentService.getByData(
    { document_id: documentId },
    { singleResult: true }
  );

  if (!document) {
    throw buildComplianceError('Compliance document not found', 404);
  }

  const normalizedExtractedFields = extractedFields || document.extracted_fields || {};
  if (document.document_type === 'HEALTH_PERMIT') {
    const sanitationGrade = getSanitationGradeFromFields(normalizedExtractedFields);
    if (sanitationGrade) {
      normalizedExtractedFields.sanitation_grade = sanitationGrade;
    }
  }

  document.ocr_status = ocrStatus || 'completed';
  document.extracted_fields = normalizedExtractedFields;
  document.ocr_completed_at = new Date();
  document.ocr_error_message = errorMessage || null;
  if (extractedFields?.expiration_date && !document.expiration_date) {
    document.expiration_date = asDate(extractedFields.expiration_date);
  }
  if (extractedFields?.issue_date && !document.issue_date) {
    document.issue_date = asDate(extractedFields.issue_date);
  }
  await document.save();
  return document;
};

const archiveExpiredDocuments = async () => {
  const now = new Date();
  const expiredDocuments = await VendorComplianceDocumentService.getByData(
    {
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
  return { reminders_sent, archived_count };
};

module.exports = {
  REMINDER_DAYS,
  calculateComplianceSummary,
  assertEligible,
  getSanitationGradeMap,
  getSanitationGradeFromFields,
  uploadComplianceDocument,
  reviewComplianceDocument,
  applyOcrResult,
  sendExpirationReminders,
  archiveExpiredDocuments,
  runComplianceMaintenance,
};
