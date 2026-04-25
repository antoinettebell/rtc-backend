const allowedImageMimeTypes = new Set([
  'image/png',
  'image/jpg',
  'image/jpeg',
  'image/heic',
]);

const isSupportedImageUpload = (file) =>
  allowedImageMimeTypes.has(file?.mimetype);

module.exports = {
  allowedImageMimeTypes,
  isSupportedImageUpload,
};
