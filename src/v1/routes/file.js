/**
 * Contains File routes
 */
const express = require('express');
const router = express.Router();
const { FileController: Controller } = require('../controllers');
const Upload = require('../../middleware/upload-item');

/** [POST] /api/v1/file */
router.post('/', Upload.single('file'), Controller.add);

module.exports = router;
