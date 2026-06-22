const express = require('express');
const { WebhookController } = require('../controllers');

const router = express.Router();

/** [POST] /api/v1/webhooks/docusign */
router.post('/docusign', WebhookController.docusign);

module.exports = router;
