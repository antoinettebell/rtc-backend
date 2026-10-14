const multer = require('multer');
const path = require('path');

const allowedMimeTypes = new Set([
  'application/pdf', 'image/png', 'image/jpg', 'image/jpeg', 'image/heic', 'image/heif',
]);

const mimeByExtension = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.heic': 'image/heic', '.heif': 'image/heif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: './uploads',
    filename: (req, file, callback) => callback(null, `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    file.mimetype = mimeByExtension[extension] || file.mimetype;
    if (allowedMimeTypes.has(file.mimetype)) return callback(null, true);
    return callback(new Error('Only PDF, JPG, PNG, and HEIC files are supported.'));
  },
}).single('file');

// Preserve original HEIC evidence. Conversion is intentionally avoided: iOS
// photos remain valid RTC records even when a server cannot decode HEIC.
module.exports = { single: () => upload };
