const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      fundedBy: Joi.string().valid('APP', 'VENDOR'),
      status: Joi.string().valid('ACTIVE', 'ARCHIVED'),
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
      fundedBy: Joi.string().valid('APP', 'VENDOR'),
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
      fundedBy: Joi.string().valid('APP', 'VENDOR'),
      status: Joi.string().valid('ACTIVE', 'ARCHIVED'),
      // usageLimit: Joi.string().valid('ONCE', 'TWICE', 'MONTHLY', 'NOLIMIT'),
      usageLimit: Joi.string().valid('NOLIMIT'),
      validFrom: Joi.string().allow(null),
      validTill: Joi.string().allow(null),
      value: Joi.number()
        .when('type', {
          is: 'PERCENTAGE',
          then: Joi.number().positive().less(101),
          otherwise: Joi.number().positive(),
        }),
      maxDiscount: Joi.number().when('type', {
        is: 'PERCENTAGE',
        then: Joi.number().greater(-1).allow(null).required(),
        otherwise: Joi.number().greater(-1),
      }),
      isActive: Joi.boolean(),
    }),
  },
};
