const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  validate: {
    query: Joi.object({
      code: Joi.string().min(4).uppercase().required(),
    }),
  },

  add: {
    body: Joi.object({
      code: Joi.string().min(4).uppercase().trim().required(),
      type: Joi.string().valid('PERCENTAGE', 'FIXED').required(),
      usageLimit: Joi.string()
        // .valid('ONCE', 'TWICE', 'MONTHLY', 'NOLIMIT')
        .valid('NOLIMIT')
        .required(),
      validFrom: Joi.string().allow(null),
      validTill: Joi.string().allow(null),
      value: Joi.number()
        .when('type', {
          is: 'PERCENTAGE',
          then: Joi.number().positive().less(101),
          otherwise: Joi.number().positive(),
        })
        .required(),
      maxDiscount: Joi.number().when('type', {
        is: 'PERCENTAGE',
        then: Joi.number().greater(-1).allow(null).required(),
        otherwise: Joi.number().greater(-1),
      }),
    }),
  },

  update: {
    body: Joi.object({
      code: Joi.string().min(4).uppercase().trim(),
      type: Joi.string().valid('PERCENTAGE', 'FIXED'),
      // usageLimit: Joi.string().valid('ONCE', 'TWICE', 'MONTHLY', 'NOLIMIT'),
      usageLimit: Joi.string().valid('NOLIMIT'),
      validFrom: Joi.string().allow(null),
      validTill: Joi.string().allow(null),
      value: Joi.number()
        .when('type', {
          is: 'PERCENTAGE',
          then: Joi.number().positive().less(101),
          otherwise: Joi.number().positive(),
        })
        .required(),
      maxDiscount: Joi.number().when('type', {
        is: 'PERCENTAGE',
        then: Joi.number().greater(-1).allow(null).required(),
        otherwise: Joi.number().greater(-1),
      }),
      isActive: Joi.boolean(),
    }),
  },
};
