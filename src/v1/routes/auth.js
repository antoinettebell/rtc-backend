/**
 * Contains Auth routes
 */
const express = require('express');
const router = express.Router();
const { AuthController: Controller } = require('../controllers');
const { validate, AuthValidation: Validation } = require('../validations');
const Upload = require('../../middleware/upload-item');

/** [POST] /api/v1/auth */
router.post('/', validate(Validation.auth), Controller.login);

/** [POST] /api/v1/auth/vendor-login */
router.post('/vendor-login', validate(Validation.auth), Controller.loginVendor);

/** [POST] /api/v1/auth/admin-login */
router.post('/admin-login', validate(Validation.auth), Controller.loginAdmin);

/** [POST] /api/v1/auth/register */
router.post(
  '/register',
  Upload.single('file'),
  validate(Validation.register),
  Controller.add
);

/** [POST] /api/v1/auth/register */
router.post(
  '/register/vendor',
  validate(Validation.registerVendor),
  Controller.addVendor
);

/** [POST] /api/v1/auth/forgot-password */
router.post(
  '/forgot-password',
  validate(Validation.forgotPassword),
  Controller.forgotPassword
);

/** [GET] /api/v1/auth/validate-token */
router.get(
  '/validate-token',
  validate(Validation.validateToken),
  Controller.validateToken
);

/** [GET] /api/v1/auth/validate-change-password-token */
router.get(
  '/validate-change-password-token',
  validate(Validation.validateChangePasswordToken),
  Controller.validateChangePasswordToken
);

/** [POST] /api/v1/auth/change-password */
router.post(
  '/change-password',
  validate(Validation.changePassword),
  Controller.changePassword
);

/** [POST] /api/v1/auth/verify-otp */
router.post(
  '/verify-otp',
  validate(Validation.verifyOTP),
  Controller.verifyOTP
);

/** [POST] /api/v1/auth/resend-otp */
router.post(
  '/resend-otp',
  validate(Validation.resendOTP),
  Controller.resendOTP
);

module.exports = router;
