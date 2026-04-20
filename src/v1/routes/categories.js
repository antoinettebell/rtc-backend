/**
 * Contains Categories routes
 */
const express = require('express');
const router = express.Router();
const { CategoriesController: Controller } = require('../controllers');
const { validate, CategoriesValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/Categories */
router.get('/', Controller.list);

/** [GET] /api/v1/Categories/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/Categories */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/Categories/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/Categories/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.destroy);


module.exports = router;
