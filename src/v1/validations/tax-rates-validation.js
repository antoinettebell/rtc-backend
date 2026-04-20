const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  check: {
    query: Joi.object({
      foodTruckId: Joi.string().trim().required(),
      locationId: Joi.string().trim().required(),
    }),
  },
avalarataxCheck:{
 query: Joi.object({
      foodTruckId: Joi.string().trim().required(),
      locationId: Joi.string().trim().required(),
      amount: Joi.number().min(0).required(),

    }),
},
  add: {
    body: Joi.object({
      stateCode: Joi.string().min(2).trim().required(),
      zip: Joi.string().min(4).trim().required(),
      taxRegion: Joi.string().min(2).trim().required(),
      estimatedCombineRate: Joi.number().min(0).required(),
      stateRate: Joi.number().min(0).required(),
      estimatedCountryRate: Joi.number().min(0).required(),
      estimatedCityRate: Joi.number().min(0).required(),
      estimatedSpecialRate: Joi.number().min(0).required(),
      riskLevel: Joi.number().min(0).required(),
    }),
  },
};
