const { Joi } = require('express-validation');

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
      fromDate: Joi.string().allow(null, ''),
      toDate: Joi.string().allow(null, ''),
    }),
  },

  update: {
    body: Joi.object({
      title: Joi.string().allow(null, ''),
      description: Joi.string().allow(null, ''),
      imageUrl: Joi.string(),
      fromDate: Joi.string().allow(null, ''),
      toDate: Joi.string().allow(null, ''),
    }),
  },
};
