const express = require('express');
const router = express.Router();
const Controller = require('../controllers/operational-compliance-form-controller');
const { allowedTo } = require('../../middleware/allow-route');

const access = allowedTo(['VENDOR', 'EMPLOYEE']);

router.get('/', access, Controller.list);
router.get('/current/:type', access, Controller.current);
router.put('/:id', access, Controller.update);
router.post('/:id/submit', access, Controller.submit);
router.patch('/:id/unlock', access, Controller.unlock);
router.post('/:id/archive', allowedTo(['VENDOR']), Controller.archive);

module.exports = router;
