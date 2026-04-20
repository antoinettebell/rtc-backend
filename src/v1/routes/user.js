/**
 * Contains user routes
 */
const express = require('express');
const router = express.Router();
const { UserController: Controller } = require('../controllers');
const { UserValidation: Validation, validate } = require('../validations');
const { allowedTo } = require('../../middleware/allow-route');

/** [GET] /api/v1/user/address */
router.get('/address', allowedTo(['CUSTOMER']), Controller.addressList);

/** [GET] /api/v1/user/address/:id */
router.get('/address/:id', allowedTo(['CUSTOMER']), Controller.addressList);

/** [POST] /api/v1/user/address */
router.post(
  '/address',
  allowedTo(['CUSTOMER']),
  validate(Validation.addAddress),
  Controller.addAddress
);

/** [GET] /api/v1/user/bank-detail */
router.get('/bank-detail', allowedTo(['VENDOR']), Controller.getBankDetail);

/** [POST] /api/v1/user/bank-detail */
router.post(
  '/bank-detail',
  allowedTo(['VENDOR']),
  validate(Validation.bankDetail),
  Controller.addBankDetail
);

/** [POST] /api/v1/user/send-notification */
router.post(
  '/send-notification',
  validate(Validation.sendNotification),
  Controller.sendNotification
);

/** [POST] /api/v1/user/admin/send-notification */
router.post(
  '/admin/send-notification',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminSendNotification),
  Controller.adminSendNotification
);

/** [GET] /api/v1/user/admin/notifications */
router.get(
  '/admin/notificationslist',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.adminNotificationList),
  Controller.adminNotificationList
);

/** [POST] /api/v1/user/set-fcm-token */
router.post(
  '/set-fcm-token',
  validate(Validation.setFCMToken),
  Controller.setFCMToken
);

/** [DELETE] /api/v1/user/remove-fcm-token/:id */
router.delete('/remove-fcm-token/:id', Controller.removeFCMToken);

/** [PUT] /api/v1/user/update-fcm-token/:id */
router.put(
  '/update-fcm-token/:id',
  validate(Validation.updateFCMToken),
  Controller.updateFCMToken
);

/** [PUT] /api/v1/user/address/:id */
router.put(
  '/address/:id',
  allowedTo(['CUSTOMER']),
  validate(Validation.updateAddress),
  Controller.updateAddress
);

/** [DELETE] /api/v1/user/address/:id */
router.delete(
  '/address/:id',
  allowedTo(['CUSTOMER']),
  Controller.deleteAddress
);

/** [GET] /api/v1/user */
router.get(
  '/',
  allowedTo(['SUPER_ADMIN', 'VENDOR']),
  validate(Validation.list),
  Controller.list
);

/** [GET] /api/v1/user/:id */
router.get('/:id', Controller.list);

/** [DELETE] /api/v1/user */
router.delete('/', Controller.deleteAccount);

/** [GET] /api/v1/user/overview/counter */
router.get(
  '/overview/counter',
  allowedTo(['SUPER_ADMIN']),
  Controller.overview
);

/** [GET] /api/v1/user/free-dessert/progress */
router.get(
  '/free-dessert/progress',
  allowedTo(['CUSTOMER']),
  Controller.getFreeDessertProgress
);

/** [PUT] /api/v1/user/:id */
router.put('/:id', validate(Validation.update), Controller.update);

/** [PATCH] /api/v1/user/:id/change-password */
router.put(
  '/:id/change-password',
  validate(Validation.changePassword),
  Controller.changePassword
);

/** [PUT] /api/v1/user/:id/change-status */
router.put(
  '/:id/change-status',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.status),
  Controller.changeStatus
);

/** [PUT] /api/v1/user/:id/change-request */
router.put(
  '/:id/change-request',
  allowedTo(['SUPER_ADMIN']),
  validate(Validation.requestStatus),
  Controller.changeRequest
);

/** [GET] /api/v1/user/favorite/food-truck */
router.get(
  '/favorite/food-truck',
  allowedTo(['CUSTOMER']),
  Controller.listFavoriteFT
);

/** [POST] /api/v1/user/favorite/food-truck/:id */
router.post(
  '/favorite/food-truck/:id',
  allowedTo(['CUSTOMER']),
  Controller.addFavoriteFT
);

/** [DELETE] /api/v1/user/favorite/food-truck/:id */
router.delete(
  '/favorite/food-truck/:id',
  allowedTo(['CUSTOMER']),
  Controller.removeFavoriteFT
);

module.exports = router;
