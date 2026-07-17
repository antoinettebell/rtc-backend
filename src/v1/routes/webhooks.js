const express = require('express');
const { WebhookController } = require('../controllers');

const router = express.Router();

/** [POST] /api/v1/webhooks/docusign */
router.post('/docusign', WebhookController.docusign);

/** [POST] /api/v1/webhooks/vendor-daily-location-check-reminders */
router.post(
  '/vendor-daily-location-check-reminders',
  WebhookController.vendorDailyLocationCheckReminders
);

/** [POST] /api/v1/webhooks/vendor-compliance/documents/:documentId/ocr-result */
router.post(
  '/vendor-compliance/documents/:documentId/ocr-result',
  WebhookController.vendorComplianceOcrResult
);

/** [POST] /api/v1/webhooks/vendor-compliance/maintenance */
router.post(
  '/vendor-compliance/maintenance',
  WebhookController.vendorComplianceMaintenance
);

/** [POST] /api/v1/webhooks/vendor-weekly-schedule-maintenance */
router.post(
  '/vendor-weekly-schedule-maintenance',
  WebhookController.vendorWeeklyScheduleMaintenance
);

module.exports = router;
