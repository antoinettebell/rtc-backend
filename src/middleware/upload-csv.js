const multer = require('multer');
const path = require('path');
const { isSupportedImageUpload } = require('./image-upload-config');

const storage = multer.memoryStorage();

const csvFieldName = 'file';
const imageFieldName = 'images';

const uploadCsv = multer({
  storage,
  fileFilter(req, file, callback) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowedMimeTypes = new Set([
      'text/csv',
      'text/plain',
      'application/csv',
      'application/vnd.ms-excel',
    ]);

    if (
      file.fieldname === csvFieldName &&
      (ext === '.csv' || allowedMimeTypes.has(file.mimetype))
    ) {
      callback(null, true);
      return;
    }

    if (file.fieldname === imageFieldName && isSupportedImageUpload(file)) {
      callback(null, true);
      return;
    }

    callback(new Error('Only CSV and menu image files are supported.'));
  },
}).fields([
  { name: csvFieldName, maxCount: 1 },
  { name: imageFieldName, maxCount: 250 },
]);

module.exports = {
  single: () => uploadCsv,
};
