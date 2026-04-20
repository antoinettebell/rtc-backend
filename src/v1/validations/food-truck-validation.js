const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      userLat: Joi.number(),
      userLong: Joi.number(),
      search: Joi.string(),
      limit: Joi.number(),
      page: Joi.number(),
      distanceInMeters: Joi.number(),
    }),
  },

  filters: {
    query: Joi.object({
      day: Joi.string()
        .valid('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')
        .required(),
      time: Joi.string().trim().required(),
      userLat: Joi.string().required(),
      userLong: Joi.string().required(),
      search: Joi.string(),
      distanceInMeters: Joi.number(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  updateExtra: {
    body: Joi.object({
      featured: Joi.boolean(),
    }),
  },

  changePlan: {
    body: Joi.object({
      planId: Joi.string().required(),
    }),
  },
  changeaddonPlan: {
    body: Joi.object({
      addOns: Joi.alternatives().try(
        Joi.array().items(Joi.string()).min(0).allow(null),
        Joi.valid(null)
      ),
    }),
  },

  filtersNew: {
    query: Joi.object({
      // day: Joi.string()
      //   .valid('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')
      //   .required(),
      // time: Joi.string().trim().required(),
      userLat: Joi.string().required(),
      userLong: Joi.string().required(),
      search: Joi.string(),
      distanceInMeters: Joi.number(),
      available: Joi.boolean(),
      limit: Joi.number(),
      page: Joi.number(),
      featured: Joi.boolean(),
    }),
  },

  globalSearch: {
    query: Joi.object({
      userLat: Joi.string().required(),
      userLong: Joi.string().required(),
      search: Joi.string().required(),
    }),
  },

  update: {
    body: Joi.object({
      name: Joi.string().min(2).trim(),
      // facebookLink: Joi.string(),
      // instagramLink: Joi.string(),
      ein: Joi.string().allow(null),
      // snn: Joi.string().allow(null),
      ssn: Joi.string().allow(null),
      planId: Joi.string().trim(),
      logo: Joi.string().min(2).trim(),
      currentLocation: Joi.string().trim().allow(null),
      // photos: Joi.array().items(Joi.string().required()).min(0).allow(null).optional(),
      photos: Joi.alternatives().try(
        Joi.array().items(Joi.string()).min(0),
        Joi.valid(null)
      ),
      cuisine: Joi.alternatives().try(
        Joi.array().items(Joi.string()).min(0),
        Joi.valid(null)
      ),
      addOns: Joi.alternatives().try(
        Joi.array().items(Joi.string()).min(0).allow(null),
        Joi.valid(null)
      ),
      infoType: Joi.string().valid('truck', 'caterer').trim(),
      socialMedia: Joi.array().items(
        Joi.object({
          mediaType: Joi.string()
            .valid(
              'FACEBOOK',
              'INSTAGRAM',
              'TWITTER',
              'LINKEDIN',
              'TIKTOK',
              'YOUTUBE',
              'SNAPCHAT',
              'PINTEREST',
              'REDDIT',
              'WEB'
            ),
          mediaUrl: Joi.string(),
        }).min(0).allow(null),
      ),
      locations: Joi.array().items(
        Joi.object({
          _id: Joi.string(),
          title: Joi.string().required(),
          address: Joi.string().required(),
          lat: Joi.string().required(),
          long: Joi.string().required(),
          zipcode: Joi.string(),
        }).min(0).allow(null),
      ),
      availability: Joi.array().items(
        Joi.object({
          _id: Joi.string(),
          locationId: Joi.string().required(),
          day: Joi.string()
            .valid('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat')
            .required(),
          startTime: Joi.string().required(),
          endTime: Joi.string().required(),
          available: Joi.boolean().required(),
        }).min(0).allow(null),
      ),
      businessHours: Joi.array().items(
        Joi.object({
          _id: Joi.string(),
          locationId: Joi.string().required(),
          startTime: Joi.string().required(),
          endTime: Joi.string().required(),
          available: Joi.boolean().required(),
        }).min(0).allow(null)
      ),
    }),
  },
};
