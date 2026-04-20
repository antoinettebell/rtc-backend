const { validate } = require('express-validation');

/** Validation schema for auth */
exports.AuthValidation = require('./auth-validation');

/** Validation schema for user */
exports.UserValidation = require('./user-validation');

/** Validation schema for food-truck */
exports.FoodTruckValidation = require('./food-truck-validation');

/** Validation schema for cuisine */
exports.CuisineValidation = require('./cuisine-validation');

/** Validation schema for setting */
exports.SettingValidation = require('./setting-validation');

/** Validation schema for menu-category */
exports.MenuCategoryValidation = require('./menu-category-validation');

/** Validation schema for menu-item */
exports.MenuItemValidation = require('./menu-item-validation');

/** Validation schema for order */
exports.OrderValidation = require('./order-validation');

/** Validation schema for banner */
exports.BannerValidation = require('./banner-validation');

/** Validation schema for diet */
exports.DietValidation = require('./diet-validation');

/** Validation schema for diet */
exports.CategoriesValidation = require('./categories-validation');

/** Validation schema for coupon */
exports.CouponValidation = require('./coupon-validation');

/** Validation schema for review */
exports.ReviewValidation = require('./review-validation');

/** Validation schema for tax-rates */
exports.TaxRatesValidation = require('./tax-rates-validation');

/** Validation schema for meat */
exports.MeatValidation = require('./meat-validation');

/**
 * export validate function which is imported from 'express-validation'
 */
exports.validate = validate;
