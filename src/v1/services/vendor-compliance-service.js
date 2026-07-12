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
    let status = 'missing';

    if (verified) {
      status = 'verified';
      score += requirement.scoreWeight;
    } else if (document?.review_status === 'pending_review') {
      status = 'pending_review';
      pendingRequirements.push(requirement.type);
    } else if (document?.review_status === 'rejected') {
      status = 'rejected';
      rejectedRequirements.push(requirement.type);
    } else if (document?.review_status === 'expired' || expired) {
      status = 'expired';
    }

    if (!document || !verified) {
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

  score = Math.min(100, score);
  const eligible = missingRequirements.length === 0 && rejectedRequirements.length === 0;
  const hasPendingReview = pendingRequirements.length > 0;
  const scoreBand = getScoreBand({ score, eligible, hasPendingReview });

  return {
    food_truck_id: foodTruck._id,
    vendor_user_id: foodTruck.userId,
    score,
    score_color: scoreBand.color,
    score_color_hex: scoreBand.hex,
    score_label: scoreBand.label,
    eligible,
    can_bid: eligible,
    can_open_accepting_orders: eligible,
    support_phone_number: SUPPORT_PHONE_NUMBER,
    message: eligible
      ? 'Vendor compliance is eligible.'
      : `Vendor compliance must be completed before bidding or accepting orders. Contact support at ${SUPPORT_PHONE_NUMBER}.`,
    requirements,
    missing_requirements: missingRequirements,
    expiring_requirements: expiringRequirements,
    pending_requirements: pendingRequirements,
    rejected_requirements: rejectedRequirements,
  };
};

const assertEligible = async (foodTruckOrId, actionLabel = 'continue') => {
  const summary = await calculateComplianceSummary(foodTruckOrId);
  if (!summary.eligible) {
    throw buildComplianceError(
      `Compliance must be complete before vendors can ${actionLabel}.`,
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

  document.ocr_status = ocrStatus || 'completed';
  document.extracted_fields = extractedFields || document.extracted_fields || {};
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
  uploadComplianceDocument,
  reviewComplianceDocument,
  applyOcrResult,
  sendExpirationReminders,
  archiveExpiredDocuments,
  runComplianceMaintenance,
};
