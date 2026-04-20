const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      foodTruckId: Joi.string().required(),
      rate: Joi.number(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  stats: {
    query: Joi.object({
      foodTruckId: Joi.string().required(),
    }),
  },

  add: {
    body: Joi.object({
      foodTruckId: Joi.string().required(),
      orderId: Joi.string(),
      rate: Joi.number().min(1).max(5).required(),
      review: Joi.string().allow(null),
      images: Joi.array().items(Joi.string()),
    }),
  },

  update: {
    body: Joi.object({
      rate: Joi.number().min(1).max(5),
      review: Joi.string().allow(null),
      images: Joi.array().items(Joi.string()),
    }),
  },
};
