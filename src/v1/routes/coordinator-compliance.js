const express = require('express');
const { CoordinatorComplianceController: Controller } = require('../controllers');
const { allowedTo } = require('../../middleware/allow-route');

const router = express.Router();

router.get('/me', allowedTo(['CUSTOMER']), Controller.status);
router.post('/w9/signing', allowedTo(['CUSTOMER']), Controller.startW9Signing);
router.post('/w9/complete', allowedTo(['CUSTOMER']), Controller.completeW9Signing);

module.exports = router;
