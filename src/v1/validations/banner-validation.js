const { Joi } = require('express-validation');

const destinationUrl = Joi.string()
  .trim()
  .allow(null, '')
  .max(2048)
  .custom((value, helpers) => {
    if (!value) return value;
    if (/[\u0000-\u001F\u007F\s]/.test(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }, 'safe URL precheck');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  add: {
    body: Joi.object({
      title: Joi.string().allow(null, ''),
      description: Joi.string().allow(null, ''),
      imageUrl: Joi.string().required(),
      adVendorName: Joi.string().allow(null, ''),
      adDestinationUrl: destinationUrl,
      isActive: Joi.boolean(),
      fromDate: Joi.string().allow(null, ''),
      toDate: Joi.string().allow(null, ''),
    }),
  },

  update: {
    body: Joi.object({
      title: Joi.string().allow(null, ''),
      description: Joi.string().allow(null, ''),
      imageUrl: Joi.string(),
      adVendorName: Joi.string().allow(null, ''),
      adDestinationUrl: destinationUrl,
      isActive: Joi.boolean(),
      fromDate: Joi.string().allow(null, ''),
      toDate: Joi.string().allow(null, ''),
    }),
  },
};
