const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      foodTruckId: Joi.string().required(),
      rate: Joi.number(),
      limit: Joi.number(),
      page: Joi.number(),
      status: Joi.string().valid('PUBLISHED', 'HIDDEN', 'REJECTED'),
    }),
  },

  stats: {
    query: Joi.object({
      foodTruckId: Joi.string().required(),
    }),
  },

  add: {
    body: Joi.object({
      foodTruckId: Joi.string(),
      orderId: Joi.string().required(),
      rate: Joi.number().integer().min(1).max(5).required(),
      review: Joi.string().allow(null),
      images: Joi.array().items(Joi.string()),
    }),
  },

  addByToken: {
    params: Joi.object({
      token: Joi.string().trim().required(),
    }),
    body: Joi.object({
      rate: Joi.number().integer().min(1).max(5).required(),
      review: Joi.string().allow(null, ''),
      images: Joi.array().items(Joi.string()),
    }),
  },

  tokenDetails: {
    params: Joi.object({
      token: Joi.string().trim().required(),
    }),
  },

  update: {
    body: Joi.object({
      rate: Joi.number().integer().min(1).max(5),
      review: Joi.string().allow(null),
      images: Joi.array().items(Joi.string()),
    }),
  },

  moderate: {
    params: Joi.object({ id: Joi.string().required() }),
    body: Joi.object({
      status: Joi.string().valid('PUBLISHED', 'HIDDEN', 'REJECTED').required(),
      reason: Joi.when('status', {
        is: 'PUBLISHED',
        then: Joi.string().allow(null, ''),
        otherwise: Joi.string().trim().required(),
      }),
    }),
  },
};
