const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      userId: Joi.string(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  add: {
    body: Joi.object({
      name: Joi.string().min(2).trim(),
      categoriesId: Joi.string().trim(),
    }),
  },

  update: {
    body: Joi.object({
      name: Joi.string().min(2).trim(),
      categoriesId: Joi.string().trim(),
    }),
  },
};
