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

module.exports = router;
