/**
 * Contains Auth routes
 */
const express = require('express');
const router = express.Router();
const { FoodTruckController: Controller } = require('../controllers');
const { validate, FoodTruckValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');
const Upload = require('../../middleware/marketplace-upload');

/** [GET] /api/v1/food-truck */
router.get('/', validate(Validation.list), Controller.list);

/** [GET] /api/v1/food-truck/:id */
router.get('/:id', Controller.list);

/** [GET] /api/v1/food-truck/:id */
router.get('/:id/menu', Controller.getMenu);

/** [PUT] /api/v1/food-truck/change-plan */
router.put(
  '/change-plan',
  allowedTo(['VENDOR']),
  validate(Validation.changePlan),
  Controller.changePlan
);

router.put(
  '/change-add-on-plan',
  allowedTo(['VENDOR']),
  validate(Validation.changeaddonPlan),
  Controller.changeaddonPlan
);

/** [PATCH] /api/v1/food-truck/complete */
router.patch('/complete', allowedTo(['VENDOR']), Controller.callComplete);

/** [PUT] /api/v1/food-truck/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.update),
  Controller.update
);

/** [POST] /api/v1/food-truck/:id/documents */
router.post(
  '/:id/documents',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Upload.single(),
  Controller.addDocument
);

/** [DELETE] /api/v1/food-truck/:id/documents/:documentId */
router.delete(
  '/:id/documents/:documentId',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Controller.deleteDocument
);

/** [PATCH] /api/v1/food-truck/:id/location/:locationId/ordering-open */
router.patch(
  '/:id/location/:locationId/ordering-open',
  allowedTo(['VENDOR', 'EMPLOYEE']),
  validate(Validation.toggleLocationOrdering),
  Controller.toggleLocationOrdering
);

/** [PUT] /api/v1/food-truck/:id/truck-units */
router.put(
  '/:id/truck-units',
  allowedTo(['VENDOR']),
  validate(Validation.updateTruckUnits),
  Controller.updateTruckUnits
);

/** [PATCH] /api/v1/food-truck/:id/truck-units/:truckUnitId */
router.patch(
  '/:id/truck-units/:truckUnitId',
  allowedTo(['VENDOR']),
  validate(Validation.updateTruckUnit),
  Controller.updateTruckUnit
);

/** [PUT] /api/v1/food-truck/:id */
router.put(
  '/:id/update-extra',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.updateExtra),
  Controller.updateExtra
);

/** [PUT] /api/v1/food-truck/:id/location/:locationId */
router.delete(
  '/:id/location/:locationId',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  Controller.deleteLocation
);

module.exports = router;
