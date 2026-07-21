const fs = require('fs');
const { addObjectWithKey } = require('../../helper/aws');
const {
  FoodTruckService,
  VendorComplianceDocumentService,
  VendorComplianceAuditService,
} = require('../services');
const VendorComplianceService = require('../services/vendor-compliance-service');
const {
  getComplianceRequirements,
  normalizeComplianceDocumentType,
} = require('../../helper/vendor-compliance-config');

const getVendorFoodTruck = async (user, foodTruckId = null) => {
  const query = {
    ...(foodTruckId ? { _id: foodTruckId } : {}),
    ...(user.userType === 'VENDOR' ? { userId: user._id } : {}),
  };

  const foodTruck = await FoodTruckService.getByData(query, {
    singleResult: true,
    populate: ['cuisine', 'planId'],
  });

  if (!foodTruck) {
    const error = new Error('Food truck not found');
    error.code = 404;
    throw error;
  }

  return foodTruck;
};

const handleError = (error, next) => next(error);

const getFoodTruckDocumentTypeFromComplianceType = (documentType) => {
  if (documentType === 'HEALTH_PERMIT') return 'PERMIT';
  if (documentType === 'BUSINESS_LICENSE') return 'LICENSE';
  if (documentType === 'COI') return 'INSURANCE';
  if (documentType === 'EIN') return 'EIN';
  if (documentType === 'W9') return 'W9';
  return 'OTHER';
};

exports.requirements = async (req, res, next) => {
  try {
    return res.data(
      {
        requirements: getComplianceRequirements(),
      },
      'Vendor compliance requirements'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.mySummary = async (req, res, next) => {
  try {
    const foodTruck = await getVendorFoodTruck(req.user, req.query.food_truck_id);
    const summary = await VendorComplianceService.calculateComplianceSummary(foodTruck);
    return res.data({ compliance: summary }, 'Vendor compliance summary');
  } catch (e) {
    return handleError(e, next);
  }
};

exports.foodTruckSummary = async (req, res, next) => {
  try {
    const foodTruck = await getVendorFoodTruck(req.user, req.params.foodTruckId);
    const summary = await VendorComplianceService.calculateComplianceSummary(foodTruck);
    return res.data({ compliance: summary }, 'Vendor compliance summary');
  } catch (e) {
    return handleError(e, next);
  }
};

exports.uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded!' });
    }

    const foodTruck = await getVendorFoodTruck(req.user, req.params.foodTruckId);
    const documentType = normalizeComplianceDocumentType(req.body.document_type);
    const { url, key } = await addObjectWithKey(
      req.file,
      `vendor-compliance/${foodTruck._id}/${documentType}`
    );

    const document = await VendorComplianceService.uploadComplianceDocument({
      foodTruck,
      file: req.file,
      body: req.body,
      user: req.user,
      fileUrl: url,
      fileKey: key,
    });

    const foodTruckDocumentType =
      getFoodTruckDocumentTypeFromComplianceType(documentType);
    foodTruck.documents = (foodTruck.documents || [])
      .map((existingDocument) => {
        const sameType =
          existingDocument?.document_type === foodTruckDocumentType &&
          existingDocument?.document_status !== 'ARCHIVED';

        if (!sameType) return existingDocument;

        const isVerified =
          existingDocument?.compliance_status === 'VERIFIED' ||
          existingDocument?.compliance_review_status === 'verified';

        if (!isVerified) return null;

        return {
          ...existingDocument,
          document_status: 'ARCHIVED',
          compliance_status: 'ARCHIVED',
          archived_at: new Date(),
        };
      })
      .filter(Boolean);
    foodTruck.documents = [
      ...(foodTruck.documents || []),
      {
        title: req.body.title || document.title,
        document_type: foodTruckDocumentType,
        file_url: url,
        file_key: key,
        original_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        uploaded_by_user_id: req.user._id,
        uploaded_at: new Date(),
        document_status: 'ACTIVE',
        compliance_status:
          document.review_status === 'verified' ? 'VERIFIED' : 'PENDING_REVIEW',
        compliance_document_id: document.document_id,
        compliance_document_type: document.document_type,
        compliance_review_status: document.review_status,
        compliance_ocr_status: document.ocr_status,
        compliance_synced_at: new Date(),
      },
    ];
    await foodTruck.save();

    fs.unlink(req.file.path, () => {});

    const summary = await VendorComplianceService.calculateComplianceSummary(foodTruck);
    return res.data(
      { complianceDocument: document, compliance: summary },
      'Compliance document uploaded'
    );
  } catch (e) {
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    return handleError(e, next);
  }
};

exports.submitDocumentsForOcr = async (req, res, next) => {
  try {
    const foodTruck = await getVendorFoodTruck(req.user, req.params.foodTruckId);
    const documents =
      await VendorComplianceService.submitComplianceDocumentsForOcr({
        foodTruck,
        user: req.user,
      });
    const summary = await VendorComplianceService.calculateComplianceSummary(foodTruck);

    return res.data(
      { complianceDocumentList: documents, compliance: summary },
      'Compliance documents submitted for OCR'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.history = async (req, res, next) => {
  try {
    const foodTruck = await getVendorFoodTruck(req.user, req.params.foodTruckId);
    const query = {
      food_truck_id: foodTruck._id,
      ...(req.query.document_type
        ? { document_type: normalizeComplianceDocumentType(req.query.document_type) }
        : {}),
    };
    const [documents, audits] = await Promise.all([
      VendorComplianceDocumentService.getByData(query, {
        sort: { created_at: -1 },
        lean: true,
      }),
      VendorComplianceAuditService.getByData(
        { food_truck_id: foodTruck._id },
        { sort: { created_at: -1 }, lean: true }
      ),
    ]);

    return res.data(
      { complianceDocumentList: documents, complianceAuditList: audits },
      'Compliance history'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.adminList = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      review_status,
      document_type,
      food_truck_id,
    } = req.query;
    await VendorComplianceService.purgeRejectedDocuments({ user: req.user });
    await VendorComplianceService.syncLegacyFoodTruckDocuments({
      foodTruckId: food_truck_id || null,
    });

    const query = {
      ...(review_status ? { review_status } : {}),
      ...(document_type
        ? { document_type: normalizeComplianceDocumentType(document_type) }
        : {}),
      ...(food_truck_id ? { food_truck_id } : {}),
    };

    const documents = await VendorComplianceDocumentService.getByData(query, {
      paging: { page, limit },
      sort: { created_at: -1 },
      populate: ['food_truck_id', 'vendor_user_id', 'reviewed_by_user_id'],
      lean: true,
    });
    const total = await VendorComplianceDocumentService.getCount(query);

    return res.data(
      {
        complianceDocumentList: documents,
        total,
        page,
        totalPages: total < limit ? 1 : Math.ceil(total / limit),
      },
      'Admin compliance documents'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.adminDashboard = async (req, res, next) => {
  try {
    await VendorComplianceService.purgeRejectedDocuments({ user: req.user });
    await VendorComplianceService.syncLegacyFoodTruckDocuments();

    const documents = await VendorComplianceDocumentService.getByData(
      { review_status: { $ne: 'archived' } },
      { sort: { created_at: -1 }, populate: ['food_truck_id'], lean: true }
    );
    const byReviewStatus = documents.reduce((acc, document) => {
      acc[document.review_status] = (acc[document.review_status] || 0) + 1;
      return acc;
    }, {});
    const byDocumentType = documents.reduce((acc, document) => {
      acc[document.document_type] = (acc[document.document_type] || 0) + 1;
      return acc;
    }, {});
    const expiringSoonCount = documents.filter((document) => {
      if (!document.expiration_date) return false;
      const days =
        (new Date(document.expiration_date).getTime() - Date.now()) /
        (24 * 60 * 60 * 1000);
      return days >= 0 && days <= 30;
    }).length;
    const foodTrucks = await FoodTruckService.getByData(
      { inactive: { $ne: true } },
      {
        sort: { name: 1 },
        lean: true,
        populate: ['userId', 'planId'],
      }
    );
    const vendorScores = await Promise.all(
      (foodTrucks || []).map(async (foodTruck) => {
        const summary = await VendorComplianceService.calculateComplianceSummary(
          foodTruck
        );
        const vendorUser = foodTruck.userId;

        return {
          food_truck_id: foodTruck._id,
          vendor_user_id:
            vendorUser && typeof vendorUser === 'object'
              ? vendorUser._id
              : vendorUser,
          vendor_name: foodTruck.name || 'Unnamed vendor',
          vendor_email:
            vendorUser && typeof vendorUser === 'object'
              ? vendorUser.email || vendorUser.emailAddress || null
              : null,
          plan_name:
            foodTruck.planId && typeof foodTruck.planId === 'object'
              ? foodTruck.planId.name || foodTruck.planId.planName || null
              : null,
          score: summary.score,
          score_color: summary.score_color,
          score_color_hex: summary.score_color_hex,
          score_label: summary.score_label,
          eligible: summary.eligible,
          missing_requirements: summary.missing_requirements || [],
          expiring_requirements: summary.expiring_requirements || [],
          pending_requirements: summary.pending_requirements || [],
          rejected_requirements: summary.rejected_requirements || [],
        };
      })
    );
    const byScoreColor = vendorScores.reduce((acc, vendor) => {
      acc[vendor.score_color] = (acc[vendor.score_color] || 0) + 1;
      return acc;
    }, {});

    return res.data(
      {
        dashboard: {
          total_documents: documents.length,
          pending_review: byReviewStatus.pending_review || 0,
          verified: byReviewStatus.verified || 0,
          rejected: byReviewStatus.rejected || 0,
          expired: byReviewStatus.expired || 0,
          expiring_soon: expiringSoonCount,
          by_review_status: byReviewStatus,
          by_document_type: byDocumentType,
          vendor_scores: vendorScores,
          by_score_color: byScoreColor,
        },
      },
      'Admin compliance dashboard'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.adminReview = async (req, res, next) => {
  try {
    const document = await VendorComplianceService.reviewComplianceDocument({
      documentId: req.params.documentId,
      reviewStatus: req.body.review_status,
      reviewNotes: req.body.review_notes,
      expirationDate: req.body.expiration_date,
      issueDate: req.body.issue_date,
      extractedFields: req.body.extracted_fields,
      user: req.user,
    });
    const summary = await VendorComplianceService.calculateComplianceSummary(
      document.food_truck_id
    );

    return res.data(
      { complianceDocument: document, compliance: summary },
      'Compliance document reviewed'
    );
  } catch (e) {
    return handleError(e, next);
  }
};

exports.ocrResult = async (req, res, next) => {
  try {
    const document = await VendorComplianceService.applyOcrResult({
      documentId: req.params.documentId,
      ocrStatus: req.body.ocr_status,
      extractedFields: req.body.extracted_fields,
      errorMessage: req.body.ocr_error_message,
    });

    return res.data({ complianceDocument: document }, 'Compliance OCR result saved');
  } catch (e) {
    return handleError(e, next);
  }
};

exports.runExpirationSweep = async (req, res, next) => {
  try {
    const result = await VendorComplianceService.runComplianceMaintenance();
    return res.data(result, 'Compliance expiration sweep complete');
  } catch (e) {
    return handleError(e, next);
  }
};
