const express = require('express');
const router = express.Router();
const {
  MarketplaceController: Controller,
  MarketplaceTicketController: TicketController,
  EventVendorController,
} = require('../controllers');
const { validate, MarketplaceValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');
const MarketplaceUpload = require('../../middleware/marketplace-upload');

router.get('/event-vendor/profile', allowedTo(['VENDOR']), EventVendorController.getProfile);
router.put('/event-vendor/profile', allowedTo(['VENDOR']), EventVendorController.saveProfile);
router.get('/event-vendor/photos', allowedTo(['VENDOR']), EventVendorController.listPhotos);
router.post('/event-vendor/photos', allowedTo(['VENDOR']), MarketplaceUpload.single(), EventVendorController.uploadPhoto);
router.post('/event-vendor/logo', allowedTo(['VENDOR']), MarketplaceUpload.single(), EventVendorController.uploadLogo);
router.delete('/event-vendor/photos/:photoId', allowedTo(['VENDOR']), EventVendorController.removePhoto);
router.get('/event-vendor/events', allowedTo(['VENDOR']), EventVendorController.eligibleEvents);
router.post('/event-vendor/events/:eventId/applications', allowedTo(['VENDOR']), EventVendorController.submitApplication);
router.get('/event-vendor/applications/my', allowedTo(['VENDOR']), EventVendorController.myApplications);
router.post('/event-vendor/applications/:applicationId/award', allowedTo(['CUSTOMER']), EventVendorController.awardApplication);
router.get('/event-vendor/events/:eventId/applications', allowedTo(['CUSTOMER']), EventVendorController.eventApplications);

router.post(
  '/events',
  allowedTo(['CUSTOMER']),
  validate(Validation.createEvent),
  Controller.createEvent
);

router.post(
  '/repository/events',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminCreateEvent),
  Controller.adminCreateEvent
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

router.post(
  '/events/:eventId/tickets/checkout',
  allowedTo(['CUSTOMER']),
  validate(Validation.checkoutTickets),
  TicketController.checkout
);

router.get(
  '/tickets/my',
  allowedTo(['CUSTOMER']),
  TicketController.myTickets
);

router.post(
  '/events/:eventId/tax-exemption-certificate',
  allowedTo(['CUSTOMER']),
  MarketplaceUpload.single(),
  TicketController.uploadExemptionCertificate
);

router.post(
  '/events/:eventId/tickets/quote',
  allowedTo(['CUSTOMER']),
  validate(Validation.quoteTickets),
  TicketController.quote
);

router.post(
  '/events/:eventId/tickets/validate',
  allowedTo(['CUSTOMER']),
  validate(Validation.validateTicket),
  TicketController.validateTicket
);

router.post(
  '/events/:eventId/tickets/close-scanner',
  allowedTo(['CUSTOMER']),
  TicketController.closeScanner
);

router.post(
  '/events/:eventId/tickets/close-sales',
  allowedTo(['CUSTOMER']),
  TicketController.closeTicketSales
);

router.post(
  '/events/:eventId/tickets/share-link',
  allowedTo(['CUSTOMER']),
  TicketController.createTicketShareLink
);

router.get(
  '/events/:eventId/tickets/summary',
  allowedTo(['CUSTOMER']),
  TicketController.coordinatorTicketSummary
);

router.post(
  '/events/:eventId/tickets/scanner-session',
  allowedTo(['CUSTOMER']),
  TicketController.createScannerSession
);

router.post(
  '/events/:eventId/tickets/cancel-event',
  allowedTo(['CUSTOMER']),
  validate(Validation.cancelTicketedEvent),
  TicketController.cancelEventAndRefundTickets
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
  '/repository/events',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminMarketplaceEvents),
  Controller.adminMarketplaceEvents
);

router.get(
  '/repository/tax-exemptions',
  allowedTo(['SUPER_ADMIN']),
  TicketController.adminListTaxExemptions
);

router.patch(
  '/repository/tax-exemptions/:eventId/review',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.reviewTaxExemption),
  TicketController.adminReviewTaxExemption
);

router.patch(
  '/repository/events/:eventId',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminUpdateEvent),
  Controller.adminUpdateEvent
);

router.patch(
  '/repository/events/:eventId/submissions/withdraw',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminWithdrawSubmission),
  Controller.adminWithdrawSubmission
);

router.post(
  '/repository/events/:eventId/award',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.awardBids),
  Controller.adminAwardBids
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

router.patch(
  '/payments/:paymentId/tip',
  allowedTo(['VENDOR']),
  validate(Validation.updateFinalPaymentTip),
  Controller.updateFinalPaymentTip
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
  '/events/:eventId/applications/:applicationId/accept',
  allowedTo(['CUSTOMER']),
  validate(Validation.acceptApplication),
  Controller.acceptApplication
);

router.post(
  '/events/:eventId/awards/:bidId/revoke',
  allowedTo(['CUSTOMER']),
  validate(Validation.revokeAward),
  Controller.revokeAward
);

router.post(
  '/events/:eventId/final-payment',
  allowedTo(['CUSTOMER', 'VENDOR']),
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

router.delete(
  '/events/:eventId/images/:imageId',
  allowedTo(['CUSTOMER', 'SUPER_ADMIN']),
  Controller.deleteEventImage
);

router.post(
  '/bids/:bidId/attachments',
  allowedTo(['VENDOR']),
  MarketplaceUpload.single(),
  validate(Validation.uploadBidAttachment),
  Controller.addBidAttachment
);

router.post(
  '/applications/:applicationId/attachments',
  allowedTo(['VENDOR']),
  MarketplaceUpload.single(),
  validate(Validation.uploadApplicationAttachment),
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
  '/bids/:bidId',
  allowedTo(['VENDOR']),
  Controller.deleteDraftBid
);

router.patch(
  '/bids/:bidId/withdraw',
  allowedTo(['VENDOR']),
  Controller.withdrawBid
);

router.delete(
  '/applications/:applicationId/attachments/:attachmentId',
  allowedTo(['VENDOR']),
  Controller.deleteApplicationAttachment
);

router.delete(
  '/applications/:applicationId',
  allowedTo(['VENDOR']),
  Controller.deleteDraftApplication
);

router.patch(
  '/applications/:applicationId/withdraw',
  allowedTo(['VENDOR']),
  Controller.withdrawApplication
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
