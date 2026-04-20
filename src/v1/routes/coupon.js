/**
 * Contains coupon routes
 */
const express = require('express');
const router = express.Router();
const { CouponController: Controller } = require('../controllers');
const { validate, CouponValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/coupon */
router.get('/', Controller.list);

/** [GET] /api/v1/coupon/validate */
router.get('/validate', validate(Validation.validate), Controller.validate);

/** [GET] /api/v1/coupon/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/coupon */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/coupon/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/coupon/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.destroy);

module.exports = router;
