const allowedImageMimeTypes = new Set([
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/heic',
  'image/heif',
]);

const isSupportedImageUpload = (file) =>
  allowedImageMimeTypes.has(file?.mimetype);

module.exports = {
  allowedImageMimeTypes,
  isSupportedImageUpload,
};
