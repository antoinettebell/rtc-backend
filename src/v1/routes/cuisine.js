/**
 * Contains Cuisine routes
 */
const express = require('express');
const router = express.Router();
const { CuisineController: Controller } = require('../controllers');
const { validate, CuisineValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/cuisine */
router.get('/', Controller.list);

/** [GET] /api/v1/cuisine/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/cuisine */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/cuisine/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/cuisine/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.destroy);

module.exports = router;
