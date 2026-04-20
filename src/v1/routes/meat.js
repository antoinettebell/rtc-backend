/**
 * Contains Meat routes
 */
const express = require('express');
const router = express.Router();
const { MeatController: Controller } = require('../controllers');
const { validate, MeatValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/meat */
router.get('/', Controller.list);

/** [GET] /api/v1/meat/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/meat */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/meat/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/meat/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.destroy);

module.exports = router;
