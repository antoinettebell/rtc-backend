/**
 * To handle file/s upload
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const heicConvert = require('heic-convert');
const sharp = require('sharp');
const { isSupportedImageUpload } = require('./image-upload-config');

/**
 * Providing storage
 *
 * @type {DiskStorage}
 */
const storage = multer.diskStorage({
  destination: './uploads',
  filename: function (req, file, cb) {
    // let ext = path.extname(file.originalname)
    cb(
      null,
      `${file.fieldname}_${Date.now()}${path.extname(file.originalname)}`
    );
  },
});

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
/**
 * Multer specific use
 *
 * @type {Multer|undefined}
 */
const uploadItem = multer({
  storage: storage,
  fileFilter: function (req, file, callback) {
    if (isSupportedImageUpload(file)) {
      callback(null, true);
    } else {
      console.log('only jpg, png & heic files are supported');
      callback(null, false);
    }
  },
  // limits: { fileSize: 2 * 1024 * 1024 },
}).single('file');

const uploadMiddleware = (req, res, next) => {
  uploadItem(req, res, async (err) => {
    if (err) return next(err);
    if (!req.file) return next();

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

    next();
  });
};

// module.exports = uploadItem;
module.exports = {
  single: () => uploadMiddleware,
};
