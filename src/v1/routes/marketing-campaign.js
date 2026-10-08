const express = require('express');
const { allowedTo } = require('../../middleware/allow-route');
const Controller = require('../controllers/marketing-campaign-controller');

const router = express.Router();
const adminOnly = allowedTo(['SUPER_ADMIN']);

router.get('/campaigns/pending', adminOnly, Controller.listPending);
router.get('/campaigns/approved', adminOnly, Controller.listApproved);
router.get('/campaigns/eligible-vendors', adminOnly, Controller.listEligibleVendors);
router.get('/campaigns/eligible-app-features', adminOnly, Controller.listEligibleAppFeatures);
router.get('/campaigns/eligible-events', adminOnly, Controller.listEligibleEvents);
router.post('/campaigns/generate', adminOnly, Controller.generate);
router.post('/campaigns/generate-app-features', adminOnly, Controller.generateAppFeatures);
router.post('/campaigns/generate-events', adminOnly, Controller.generateEvents);
router.get('/campaigns/:campaignId', adminOnly, Controller.getDetails);
router.post('/campaigns/:campaignId/approve', adminOnly, Controller.approve);
router.post('/campaigns/:campaignId/discard', adminOnly, Controller.discard);
router.post('/campaigns/:campaignId/regenerate', adminOnly, Controller.regenerate);
// Social Media Automation content shares the Admin marketing review surface, but never schedules or publishes here.
router.get('/social-content', adminOnly, Controller.listSocialContent);
router.post('/social-content/request-decision', adminOnly, Controller.requestSocialContentDecision);
router.get('/social-content/:contentId', adminOnly, Controller.getSocialContent);
router.post('/social-content/:contentId/verification-complete', adminOnly, Controller.completeSocialContentVerification);
router.post('/social-content/:contentId/creative/generate', adminOnly, Controller.generateSocialContentCreative);
router.post('/social-content/:contentId/creative/regenerate', adminOnly, Controller.regenerateSocialContentCreative);
router.get('/social-content/:contentId/creative/preview', adminOnly, Controller.getSocialContentCreativePreview);
router.post('/social-content/:contentId/approve', adminOnly, Controller.approveSocialContent);
router.post('/social-content/:contentId/reject', adminOnly, Controller.rejectSocialContent);

module.exports = router;
