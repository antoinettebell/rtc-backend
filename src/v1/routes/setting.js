/**
 * Contains Setting routes
 */
const express = require('express');
const router = express.Router();
const { SettingController: Controller } = require('../controllers');
const { validate, SettingValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/setting */
router.get('/', allowedTo(['SUPER_ADMIN']), Controller.getAll);

/** [POST] /api/v1/setting/terms-conditions */
router.post(
  '/terms-conditions',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.termsConditions),
  Controller.updateTerms
);

/** [POST] /api/v1/setting/privacy-policy */
router.post(
  '/privacy-policy',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.privacyPolicy),
  Controller.updatePolicy
);

/** [POST] /api/v1/setting/agreement */
router.post(
  '/agreement',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.agreement),
  Controller.updateAgreement
);

/** [POST] /api/v1/setting/free-dessert */
router.post(
  '/free-dessert',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.freeDessert),
  Controller.updateFreeDessert
);

module.exports = router;
