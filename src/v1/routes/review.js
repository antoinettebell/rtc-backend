/**
 * Contains Review routes
 */
const express = require('express');
const router = express.Router();
const { ReviewController: Controller } = require('../controllers');
const { validate, ReviewValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/review */
router.get('/', validate(Validation.list), Controller.list);

/** [GET] /api/v1/review/stats */
router.get('/stats', validate(Validation.stats), Controller.stats);

/** [GET] /api/v1/review/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/review */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN', 'CUSTOMER']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/review/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'CUSTOMER']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/review/:id */
router.delete(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'CUSTOMER']),
  Controller.destroy
);

module.exports = router;
