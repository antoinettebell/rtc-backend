/**
 * Contains Diet routes
 */
const express = require('express');
const router = express.Router();
const { DietController: Controller } = require('../controllers');
const { validate, DietValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/diet */
router.get('/', Controller.list);

/** [GET] /api/v1/diet/user-restrict-diet-list/:id */
router.get('/user-restrict-diet-list', allowedTo(['CUSTOMER']),Controller.userRestrictDietList);

/** [GET] /api/v1/diet/:id */
router.get('/:id', Controller.list);

/** [POST] /api/v1/diet */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.add),
  Controller.add
);

/** [PUT] /api/v1/diet/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.update),
  Controller.update
);

/** [DELETE] /api/v1/diet/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.destroy);

/** [POST] /api/v1/diet/user-restrict-diet */
router.post(
  '/user-restrict-diet',
  allowedTo(['CUSTOMER']),
  Controller.addOrUpdateUserRestrictDiet
);


module.exports = router;
