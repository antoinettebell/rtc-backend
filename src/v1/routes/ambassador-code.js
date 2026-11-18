const express = require('express');
const router = express.Router();
const { AmbassadorCodeController: Controller } = require('../controllers');
const { allowedTo } = require('../../middleware/allow-route');

router.get('/', allowedTo(['SUPER_ADMIN']), Controller.list);
router.post('/', allowedTo(['SUPER_ADMIN']), Controller.add);
router.put('/:id', allowedTo(['SUPER_ADMIN']), Controller.update);
router.delete('/:id', allowedTo(['SUPER_ADMIN']), Controller.archive);
router.put('/assign/:userId', allowedTo(['SUPER_ADMIN']), Controller.assignToUser);

module.exports = router;
