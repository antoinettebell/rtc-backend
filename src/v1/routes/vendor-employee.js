/**
 * Contains vendor employee routes
 */
const express = require('express');
const router = express.Router();
const { VendorEmployeeController: Controller } = require('../controllers');
const {
  validate,
  VendorEmployeeValidation: Validation,
} = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

router.get(
  '/',
  allowedTo(['VENDOR']),
  validate(Validation.list),
  Controller.list
);

router.post(
  '/',
  allowedTo(['VENDOR']),
  validate(Validation.add),
  Controller.add
);

router.get('/dashboard', allowedTo(['EMPLOYEE']), Controller.dashboard);

router.post('/session/end', allowedTo(['EMPLOYEE']), Controller.endSession);

router.post('/session/duty', allowedTo(['EMPLOYEE']), Controller.toggleDuty);

router.post('/session/action', allowedTo(['EMPLOYEE']), Controller.shiftAction);

router.get('/orders', allowedTo(['EMPLOYEE']), Controller.employeeOrders);

router.get(
  '/refund-cancel-requests',
  allowedTo(['VENDOR', 'EMPLOYEE']),
  validate(Validation.listRefundCancelRequests),
  Controller.listRefundCancelRequests
);

router.post(
  '/refund-cancel-requests',
  allowedTo(['EMPLOYEE']),
  validate(Validation.submitRefundCancelRequest),
  Controller.submitRefundCancelRequest
);

router.put(
  '/refund-cancel-requests/:requestId/review',
  allowedTo(['VENDOR']),
  validate(Validation.reviewRefundCancelRequest),
  Controller.reviewRefundCancelRequest
);

router.get(
  '/admin',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminList),
  Controller.adminList
);

router.post(
  '/admin',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminAdd),
  Controller.adminAdd
);

router.put(
  '/admin/:id',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.update),
  Controller.adminUpdate
);

router.put(
  '/admin/:id/reset-pin',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminResetPin),
  Controller.adminResetPin
);

router.patch(
  '/admin/:id/archive',
  allowedTo(['SUPER_ADMIN']),
  Controller.adminArchive
);

router.delete(
  '/admin/:id',
  allowedTo(['SUPER_ADMIN']),
  Controller.adminRemove
);

router.put(
  '/:id',
  allowedTo(['VENDOR']),
  validate(Validation.update),
  Controller.update
);

router.put(
  '/:id/reset-pin',
  allowedTo(['VENDOR']),
  validate(Validation.resetPin),
  Controller.resetPin
);

router.patch('/:id/archive', allowedTo(['VENDOR']), Controller.archive);

router.delete('/:id', allowedTo(['VENDOR']), Controller.remove);

module.exports = router;
