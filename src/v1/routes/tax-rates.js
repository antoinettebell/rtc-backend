/**
 * Contains tax-rates routes
 */
const express = require('express');
const router = express.Router();
const { TaxRatesController: Controller } = require('../controllers');
const { validate, TaxRatesValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/tax-rates */
router.get('/', allowedTo(['SUPER_ADMIN']), Controller.list);

/** [GET] /api/v1/tax-rates/check */
router.get('/check', validate(Validation.check), Controller.check);

/** [GET] /api/v1/tax-rates/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/tax-rates */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.add),
  Controller.add
);

/** [DELETE] /api/v1/tax-rates/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.destroy);

module.exports = router;
