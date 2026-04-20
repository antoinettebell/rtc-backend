/**
 * Contains Category routes
 */
const express = require('express');
const router = express.Router();
const { CategoryController: Controller } = require('../controllers');
const {
  validate,
  MenuCategoryValidation: Validation,
} = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/category */
router.get('/', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.list);

/** [GET] /api/v1/category/:id */
router.get('/:id', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.list);

/** [POST] /api/v1/category */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/category/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/category/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.destroy);

module.exports = router;
