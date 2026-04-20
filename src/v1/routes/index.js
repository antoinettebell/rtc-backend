/**
 * Main route file for V1 routes
 */
const express = require('express');
const publicRoutes = require('./public');
const authRoutes = require('./auth');
const userRoutes = require('./user');
const foodTruckRoutes = require('./food-truck');
const cuisineRoutes = require('./cuisine');
const settingRoutes = require('./setting');
const categoryRoutes = require('./category');
const menuRoutes = require('./menu');
const orderRoutes = require('./order');
const bannerRoutes = require('./banner');
const dietRoutes = require('./diet');
const categoriesRoutes = require('./categories');
const fileRoutes = require('./file');
const couponRoutes = require('./coupon');
const reviewRoutes = require('./review');
const taxRatesRoutes = require('./tax-rates');
const meatRoutes = require('./meat');
const authenticate = require('../../middleware/authenticate');
const router = express.Router();

/** Auth routes */
router.use('/auth', authRoutes);

/** Public routes */
router.use('/public', publicRoutes);

/////////////////////////////////////////////////////////////
//                                                         //
//    Above routes does not require any authentication.    //
//                                                         //
/////////////////////////////////////////////////////////////

/**
 * Inject middleware.
 * The routes below this line will require Authentication.
 */
router.use(authenticate);

/** user routes */
router.use('/user', userRoutes);

/** food-truck routes */
router.use('/food-truck', foodTruckRoutes);

/** cuisine routes */
router.use('/cuisine', cuisineRoutes);

/** file routes */
router.use('/file', fileRoutes);

/** setting routes */
router.use('/setting', settingRoutes);

/** category routes */
router.use('/category', categoryRoutes);

/** menu routes */
router.use('/menu', menuRoutes);

/** order routes */
router.use('/order', orderRoutes);

/** banner routes */
router.use('/banner', bannerRoutes);

/** diet routes */
router.use('/diet', dietRoutes);

/** Categories routes */
router.use('/categories', categoriesRoutes);

/** coupon routes */
router.use('/coupon', couponRoutes);

/** review routes */
router.use('/review', reviewRoutes);

/** tax-rates routes */
router.use('/tax-rates', taxRatesRoutes);

/** meat-routes routes */
router.use('/meat', meatRoutes);

/** Exports default route */
module.exports = router;
