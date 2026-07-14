const express = require('express');
const router = express.Router();
const { VendorComplianceController: Controller } = require('../controllers');
const { allowedTo } = require('../../middleware/allow-route');
const Upload = require('../../middleware/marketplace-upload');

router.get(
  '/requirements',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Controller.requirements
);

router.get('/me', allowedTo(['VENDOR']), Controller.mySummary);

router.get(
  '/food-truck/:foodTruckId',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Controller.foodTruckSummary
);

router.post(
  '/food-truck/:foodTruckId/documents',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Upload.single(),
  Controller.uploadDocument
);

router.get(
  '/food-truck/:foodTruckId/history',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Controller.history
);

router.get(
  '/admin/dashboard',
  allowedTo(['SUPER_ADMIN']),
  Controller.adminDashboard
);

router.get('/admin/documents', allowedTo(['SUPER_ADMIN']), Controller.adminList);

router.patch(
  '/admin/documents/:documentId/review',
  allowedTo(['SUPER_ADMIN']),
  Controller.adminReview
);

router.post(
  '/admin/expiration-sweep',
  allowedTo(['SUPER_ADMIN']),
  Controller.runExpirationSweep
);

router.post(
  '/documents/:documentId/ocr-result',
  allowedTo(['SUPER_ADMIN']),
  Controller.ocrResult
);

module.exports = router;
