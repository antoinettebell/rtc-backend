const express = require('express');
const { CoordinatorComplianceController: Controller } = require('../controllers');
const { allowedTo } = require('../../middleware/allow-route');
const Upload = require('../../middleware/coordinator-compliance-upload');

const router = express.Router();

// Keep the root alias for clients built before the explicit /me contract.
// Both routes return only the authenticated coordinator's isolated record.
router.get('/', allowedTo(['CUSTOMER']), Controller.status);
router.get('/me', allowedTo(['CUSTOMER']), Controller.status);
router.put('/profile', allowedTo(['CUSTOMER']), Controller.saveProfile);
router.post('/documents', allowedTo(['CUSTOMER']), Upload.single(), Controller.uploadDocument);
router.post('/ocr', allowedTo(['CUSTOMER']), Controller.submitDocumentsForOcr);
router.post('/w9/signing', allowedTo(['CUSTOMER']), Controller.startW9Signing);
router.post('/w9/complete', allowedTo(['CUSTOMER']), Controller.completeW9Signing);

module.exports = router;
