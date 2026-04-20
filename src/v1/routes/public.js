/**
 * Contains Public routes
 */
const express = require('express');
const router = express.Router();
const {
  FoodTruckController,
  SettingController,
  MenuController,
  PlanController,
  BannerController,
  DietController,
  CommonDataListController,
  ReviewController,
  TaxRatesController,
  CouponController,
  AddOnsController,
} = require('../controllers');
const {
  FoodTruckValidation,
  ReviewValidation,
  MenuItemValidation,
  TaxRatesValidation,
  CouponValidation,
  validate,
} = require('../validations');
const authenticate = require('../../middleware/authenticate');

/** [GET] /api/v1/public/food-truck */
router.get('/food-truck', FoodTruckController.list);

/** [GET] /api/v1/public/menu */
router.get('/menu', MenuController.list);

/** [GET] /api/v1/public/food-truck-filter */
router.get(
  '/food-truck-filter',
  authenticate,
  validate(FoodTruckValidation.filters),
  FoodTruckController.filterFT
);

/** [GET] /api/v1/public/food-truck-filter-new */
router.get( 
  '/food-truck-filter-new',
  authenticate,
  validate(FoodTruckValidation.filtersNew),
  FoodTruckController.filterNewFT
);

/** [GET] /api/v1/public/global-search */
router.get(
  '/global-search',
  authenticate,
  validate(FoodTruckValidation.globalSearch),
  FoodTruckController.globalSearch
);

/** [GET] /api/v1/public/food-truck/:id */
router.get('/food-truck/:id', authenticate, FoodTruckController.list);

/** [GET] /api/v1/public/food-truck/:id/menu */
router.get('/food-truck/:id/menu',authenticate, FoodTruckController.getMenu);

/** [GET] /api/v1/public/terms-conditions */
router.get('/terms-conditions', SettingController.getTerm);

/** [GET] /api/v1/public/privacy-policy */
router.get('/privacy-policy', SettingController.getPolicy);

/** [GET] /api/v1/public/agreement */
router.get('/agreement', SettingController.getAgreement);

/** [GET] /api/v1/public/plan */
router.get('/plan', PlanController.list);

/** [GET] /api/v1/public/banner */
router.get('/banner', BannerController.list);

/** [GET] /api/v1/public/diet */
router.get('/diet', DietController.list);

/** [GET] /api/v1/public/review */
router.get('/review', validate(ReviewValidation.list), ReviewController.list);

/** [GET] /api/v1/public/review/stats */
router.get(
  '/review/stats',
  validate(ReviewValidation.stats),
  ReviewController.stats
);

/** [GET] /api/v1/public/menu-check-items */
router.post(
  '/menu-check-items',
  validate(MenuItemValidation.checkItems),
  MenuController.checkItems
);

/** [GET] /api/v1/public/tax-rates-check */
router.get(
  '/tax-rates-check',
  validate(TaxRatesValidation.check),
  TaxRatesController.check
);

/** [GET] /api/v1/public/avalaratax-rates-check */
router.get(
  '/avalaratax-rates-check',
  validate(TaxRatesValidation.avalarataxCheck),
  TaxRatesController.avalarataxcheck
);

/** [GET] /api/v1/public/coupon */
router.get('/coupon', CouponController.list);

/** [GET] /api/v1/public/coupon-validate */
router.get(
  '/coupon-validate',
  authenticate,
  validate(CouponValidation.validate),
  CouponController.validate
);

/** [GET] /api/v1/public/add-ons */
router.get('/add-ons', AddOnsController.list);

/** [GET] /api/v1/public/diet */
router.get('/common-list', CommonDataListController.list);

module.exports = router;
