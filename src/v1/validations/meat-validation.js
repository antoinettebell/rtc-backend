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
      name: Joi.string().min(2).trim().required(),
    }),
  },

  update: {
    body: Joi.object({
      name: Joi.string().min(2).trim(),
    }),
  },
};
