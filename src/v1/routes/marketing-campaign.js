const express = require('express');
const { allowedTo } = require('../../middleware/allow-route');
const Controller = require('../controllers/marketing-campaign-controller');

const router = express.Router();
const adminOnly = allowedTo(['SUPER_ADMIN']);

router.get('/campaigns/pending', adminOnly, Controller.listPending);
router.get('/campaigns/approved', adminOnly, Controller.listApproved);
router.post('/campaigns/generate', adminOnly, Controller.generate);
router.get('/campaigns/:campaignId', adminOnly, Controller.getDetails);
router.post('/campaigns/:campaignId/approve', adminOnly, Controller.approve);
router.post('/campaigns/:campaignId/regenerate', adminOnly, Controller.regenerate);

module.exports = router;
