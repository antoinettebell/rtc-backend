/**
 * Main route file
 */
const express = require('express');
const v1Routes = require('./v1/routes');
const { OrderController } = require('./v1/controllers');
const router = express.Router();
const { server } = require('./config');

/**
 * Server status route
 */
router.get('/', (req, res) => {
  res.message(`'${server.name}' started`);
});

/**
 * Image retrieve route
 */
router.use('/images', express.static('images'));

/**
 * Shipday relay webhook route.
 */
router.post('/api/orders/shipday-update', OrderController.shipdayUpdate);

/**
 * Route to V1 APIs
 */
router.use('/api/v1', v1Routes);

/**
 * Default exports
 */
module.exports = router;
