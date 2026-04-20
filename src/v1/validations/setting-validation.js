const { Joi } = require('express-validation');

module.exports = {
  termsConditions: {
    body: Joi.object({
      termsConditions: Joi.string().min(2).trim().required(),
    }),
  },

  privacyPolicy: {
    body: Joi.object({
      privacyPolicy: Joi.string().min(2).trim().required(),
    }),
  },

  agreement: {
    body: Joi.object({
      agreement: Joi.string().min(2).trim().required(),
    }),
  },

  freeDessert: {
    body: Joi.object({
      freeDessertAmount: Joi.number().min(0).required(),
      freeDessertOrderCount: Joi.number().min(1).required(),
      isFreeDessertEnabled: Joi.boolean().required(),
    }),
  },
};
