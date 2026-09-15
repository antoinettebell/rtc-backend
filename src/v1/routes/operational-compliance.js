const express = require('express');
const router = express.Router();
const Controller = require('../controllers/operational-compliance-form-controller');
const { allowedTo } = require('../../middleware/allow-route');

const access = allowedTo(['VENDOR', 'EMPLOYEE']);

router.get('/', access, Controller.list);
router.get('/current/:type', access, Controller.current);
router.get('/checklist-tasks/:type', allowedTo(['VENDOR']), Controller.listChecklistTasks);
router.post('/checklist-tasks', allowedTo(['VENDOR']), Controller.createChecklistTask);
router.post('/checklist-tasks/:taskId/archive', allowedTo(['VENDOR']), Controller.archiveChecklistTask);
router.put('/:id', access, Controller.update);
router.post('/:id/submit', access, Controller.submit);
router.patch('/:id/unlock', access, Controller.unlock);
router.post('/:id/archive', allowedTo(['VENDOR']), Controller.archive);
router.post('/inventory/items', allowedTo(['VENDOR']), Controller.createInventoryItem);
router.put('/inventory/:id/items/:itemId', allowedTo(['VENDOR']), Controller.updateInventoryItem);
router.post('/inventory/:id/items/:itemId/submit', allowedTo(['VENDOR']), Controller.submitInventoryItem);
router.post('/inventory/:id/items/:itemId/close-count', allowedTo(['VENDOR']), Controller.closeInventoryCount);
router.post('/inventory/:id/items/:itemId/archive', allowedTo(['VENDOR']), Controller.archiveInventoryItem);
router.post('/inventory/:id/discard-draft', allowedTo(['VENDOR']), Controller.discardEmployeeInventoryDraft);
router.post('/inventory/:id/review', allowedTo(['VENDOR']), Controller.reviewEmployeeInventory);

module.exports = router;
