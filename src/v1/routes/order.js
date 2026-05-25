/**
 * Contains Order routes
 */
const express = require('express');
const router = express.Router();
const { OrderController: Controller } = require('../controllers');
const { validate, OrderValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/order */
router.get('/', validate(Validation.list), Controller.list);

/** [GET] /api/v1/order/free-dessert/eligibility */
router.get(
  '/free-dessert/eligibility',
  allowedTo(['CUSTOMER']),
  Controller.getFreeDessertEligibility
);

/** [POST] /api/v1/order */
router.post(
  '/',
  allowedTo(['CUSTOMER', 'VENDOR', 'EMPLOYEE']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/order/:id */
router.put('/:id', validate(Validation.update), Controller.update);

/** [GET] /api/v1/order/vendor/earnings */
router.get('/vendor/dashboard', allowedTo(['VENDOR']), validate(Validation.vendorDashboard), Controller.getVendorDashboard);

/** [GET] /api/v1/order/vendor/earnings */
router.get('/vendor/earnings', allowedTo(['VENDOR']), validate(Validation.vendorEarnings), Controller.getVendorEarnings);

/** [GET] /api/v1/order/vendor/earning_list */
router.get('/vendor/earning_list', allowedTo(['VENDOR']), validate(Validation.Earningslist), Controller.getVendorEarningsList);

router.post(
  '/validate-order',
  allowedTo(['CUSTOMER', 'VENDOR', 'EMPLOYEE']),
  validate(Validation.validateOrder),
  Controller.validateOrder
);

/** [GET] /api/v1/order/payment-checkout */
router.post(
  '/payment-checkout',
  allowedTo(['CUSTOMER', 'VENDOR', 'EMPLOYEE']),
  validate(Validation.checkout),
  Controller.paymentCheckout
);

router.post(
  '/payment-refund',
  // allowedTo(['CUSTOMER']),
  validate(Validation.refund),
  Controller.refundPayment
);

router.post(
  '/:id/refund',
  allowedTo(['VENDOR']),
  validate(Validation.posRefund),
  Controller.refundPosOrder
);

/** [GET] /api/v1/order/admin/transaction-list */
router.get('/admin/transaction-list',allowedTo(['SUPER_ADMIN']), validate(Validation.paymentTransactionslist), Controller.paymentTransactionslist);

/** [GET] /api/v1/order/:id */
router.get('/:id', Controller.list);

module.exports = router;
