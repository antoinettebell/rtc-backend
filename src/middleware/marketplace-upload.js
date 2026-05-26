const multer = require('multer');
const path = require('path');
const fs = require('fs');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const { isSupportedImageUpload } = require('./image-upload-config');

const MAX_MARKETPLACE_FILE_SIZE = 10 * 1024 * 1024;
const allowedMarketplaceMimeTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/heic',
]);

const storage = multer.diskStorage({
  destination: './uploads',
  filename: function (req, file, cb) {
    cb(
      null,
      `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

const isSupportedMarketplaceUpload = (file) =>
  allowedMarketplaceMimeTypes.has(file?.mimetype);

async function convertHEIC(filePath) {
  const inputBuffer = fs.readFileSync(filePath);
  const pngBuffer = await heicConvert({
    buffer: inputBuffer,
    format: 'PNG',
    quality: 1,
  });
  const newPath = filePath.replace(/\.heic$/i, '.jpg');
  await sharp(pngBuffer).jpeg({ quality: 75 }).toFile(newPath);
  fs.unlinkSync(filePath);
  return newPath;
}

const uploadItem = multer({
  storage,
  fileFilter: function (req, file, callback) {
    if (isSupportedMarketplaceUpload(file)) {
      callback(null, true);
    } else {
      callback(new Error('Only PDF, JPG, PNG, and HEIC files are supported.'));
    }
  },
  limits: { fileSize: MAX_MARKETPLACE_FILE_SIZE },
}).single('file');

const uploadMiddleware = (req, res, next) => {
  uploadItem(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next();

    if (isSupportedImageUpload(req.file)) {
      const originalExt = path.extname(req.file.originalname).toLowerCase();
      if (originalExt === '.heic') {
        try {
          const originalPath = req.file.path;
          const newPath = await convertHEIC(originalPath);

          req.file.filename = path.basename(newPath);
          req.file.originalname = req.file.originalname.replace(
            /\.heic$/i,
            '.jpg'
          );
          req.file.path = newPath;
          req.file.mimetype = 'image/jpeg';
        } catch (e) {
          return next(new Error('Failed to convert HEIC to JPG'));
        }
      }
    }

    next();
  });
};

module.exports = {
  MAX_MARKETPLACE_FILE_SIZE,
  allowedMarketplaceMimeTypes,
  isSupportedMarketplaceUpload,
  single: () => uploadMiddleware,
};
