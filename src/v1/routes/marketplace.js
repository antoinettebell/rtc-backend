const express = require('express');
const router = express.Router();
const { MarketplaceController: Controller } = require('../controllers');
const { validate, MarketplaceValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');
const MarketplaceUpload = require('../../middleware/marketplace-upload');

router.post(
  '/events',
  allowedTo(['CUSTOMER']),
  validate(Validation.createEvent),
  Controller.createEvent
);

router.put(
  '/events/:eventId',
  allowedTo(['CUSTOMER']),
  validate(Validation.updateEvent),
  Controller.updateEvent
);

router.delete(
  '/events/:eventId',
  allowedTo(['CUSTOMER']),
  Controller.deleteDraftEvent
);

router.post(
  '/events/:eventId/reopen',
  allowedTo(['CUSTOMER']),
  validate(Validation.reopenEvent),
  Controller.reopenEvent
);

router.post(
  '/events/:eventId/close',
  allowedTo(['CUSTOMER']),
  validate(Validation.closeEvent),
  Controller.closeEvent
);

router.get(
  '/events/my',
  allowedTo(['CUSTOMER']),
  Controller.myEvents
);

router.get(
  '/events/open',
  allowedTo(['VENDOR']),
  validate(Validation.openEvents),
  Controller.getOpenEvents
);

router.get(
  '/notifications/summary',
  allowedTo(['VENDOR']),
  Controller.vendorNotificationSummary
);

router.get(
  '/repository/files',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  validate(Validation.repositoryFiles),
  Controller.repositoryFiles
);

router.get(
  '/repository/files/:attachmentId/access',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  Controller.repositoryFileAccess
);

router.post(
  '/vendor-agreements/signing',
  allowedTo(['VENDOR']),
  validate(Validation.startVendorAgreementSigning),
  Controller.startVendorAgreementSigning
);

router.post(
  '/vendor-agreements/:agreementId/return',
  allowedTo(['VENDOR']),
  validate(Validation.vendorAgreementReturn),
  Controller.vendorAgreementReturn
);

router.patch(
  '/repository/files/:attachmentId/status',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  validate(Validation.updateRepositoryFileStatus),
  Controller.updateRepositoryFileStatus
);

router.get(
  '/payments',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminMarketplacePayments),
  Controller.adminMarketplacePayments
);

router.get(
  '/payments/:paymentId',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  Controller.getPayment
);

router.post(
  '/payments/:paymentId/checkout',
  allowedTo(['CUSTOMER', 'VENDOR']),
  validate(Validation.checkoutPayment),
  Controller.checkoutPayment
);

router.post(
  '/payments/:paymentId/call',
  allowedTo(['CUSTOMER', 'VENDOR']),
  Controller.initiateCallPayment
);

router.post(
  '/payments/:paymentId/admin-mark-paid',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminMarkPaymentPaid),
  Controller.adminMarkPaymentPaid
);

router.get(
  '/events/:eventId',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  Controller.getEvent
);

router.get(
  '/events/:eventId/questions',
  allowedTo(['CUSTOMER', 'VENDOR', 'SUPER_ADMIN']),
  Controller.getEventQuestions
);

router.post(
  '/events/:eventId/questions',
  allowedTo(['CUSTOMER', 'VENDOR']),
  validate(Validation.askEventQuestion),
  Controller.askEventQuestion
);

router.post(
  '/events/:eventId/questions/:questionId/answer',
  allowedTo(['CUSTOMER', 'SUPER_ADMIN']),
  validate(Validation.answerEventQuestion),
  Controller.answerEventQuestion
);

router.patch(
  '/events/:eventId/questions/:questionId/status',
  allowedTo(['CUSTOMER', 'SUPER_ADMIN']),
  validate(Validation.updateEventQuestionStatus),
  Controller.updateEventQuestionStatus
);

router.get(
  '/events/:eventId/bids',
  allowedTo(['CUSTOMER']),
  Controller.getEventBids
);

router.post(
  '/events/:eventId/bids',
  allowedTo(['VENDOR']),
  validate(Validation.submitBid),
  Controller.submitBid
);

router.post(
  '/events/:eventId/applications',
  allowedTo(['VENDOR']),
  validate(Validation.submitApplication),
  Controller.submitApplication
);

router.post(
  '/events/:eventId/award',
  allowedTo(['CUSTOMER']),
  validate(Validation.awardBids),
  Controller.awardBids
);

router.post(
  '/events/:eventId/final-payment',
  allowedTo(['CUSTOMER']),
  validate(Validation.createFinalEventPayment),
  Controller.createFinalEventPayment
);

router.patch(
  '/events/:eventId/status',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.updateEventStatus),
  Controller.updateEventStatus
);

router.post(
  '/events/:eventId/images',
  allowedTo(['CUSTOMER', 'SUPER_ADMIN']),
  MarketplaceUpload.single(),
  Controller.addEventImage
);

router.post(
  '/events/:eventId/coordinator-payment-qr',
  allowedTo(['CUSTOMER']),
  MarketplaceUpload.single(),
  Controller.uploadCoordinatorPaymentQrCode
);

router.delete(
  '/events/:eventId/images/:imageId',
  allowedTo(['CUSTOMER', 'SUPER_ADMIN']),
  Controller.deleteEventImage
);

router.post(
  '/bids/:bidId/attachments',
  allowedTo(['VENDOR']),
  MarketplaceUpload.single(),
  Controller.addBidAttachment
);

router.post(
  '/applications/:applicationId/attachments',
  allowedTo(['VENDOR']),
  validate(Validation.uploadApplicationAttachment),
  MarketplaceUpload.single(),
  Controller.addApplicationAttachment
);

router.post(
  '/applications/:applicationId/vendor-fee-payment',
  allowedTo(['VENDOR']),
  Controller.createApplicationVendorFeePayment
);

router.delete(
  '/bids/:bidId/attachments/:attachmentId',
  allowedTo(['VENDOR']),
  Controller.deleteBidAttachment
);

router.delete(
  '/applications/:applicationId/attachments/:attachmentId',
  allowedTo(['VENDOR']),
  Controller.deleteApplicationAttachment
);

router.get(
  '/bids/my',
  allowedTo(['VENDOR']),
  Controller.myBids
);

router.get(
  '/applications/my',
  allowedTo(['VENDOR']),
  Controller.myApplications
);

router.get(
  '/bids/awarded',
  allowedTo(['VENDOR']),
  Controller.awardedBids
);

module.exports = router;
