/**
 * Contains Menu routes
 */
const express = require('express');
const router = express.Router();
const { MenuController: Controller } = require('../controllers');
const { validate, MenuItemValidation: Validation } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/menu */
router.get('/', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.list);

/** [GET] /api/v1/menu/:id */
router.get('/:id', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.list);

/** [POST] /api/v1/menu */
router.post(
  '/',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.add),
  Controller.add
);

/** [POST] /api/v1/menu/check-items */
router.post(
  '/check-items',
  validate(Validation.checkItems),
  Controller.checkItems
);

/** [PUT] /api/v1/menu/:id */
router.put(
  '/:id',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  // validate(Validation.update),
  Controller.update
);

router.put( 
  '/change-availability/:id',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.availability),
  Controller.updateaAvailability
);


/** [DELETE] /api/v1/menu/:id */
router.delete('/:id', allowedTo(['SUPER_ADMIN', 'VENDOR']), Controller.destroy);

module.exports = router;
