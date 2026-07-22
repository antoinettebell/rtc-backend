const { Joi } = require('express-validation');

const scheduleChangeDayValidation = Joi.string()
  .valid(
    'Sun',
    'Mon',
    'Tue',
    'Wed',
    'Thu',
    'Fri',
    'Sat',
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
    'sun',
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
  )
  .allow(null, '');

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

  toggleLocationOrdering: {
    body: Joi.object({
      isOrderingOpen: Joi.boolean().required(),
      truck_unit_id: Joi.string().trim().allow(null, ''),
      schedule_override_reason: Joi.string()
        .trim()
        .valid('OPENING_EARLY', 'CLOSING_EARLY', 'ADMIN_OVERRIDE', 'MANUAL')
        .allow(null, ''),
    }),
  },

  updateTruckUnits: {
    body: Joi.object({
      food_truck_count: Joi.number().integer().min(1).required(),
      create_name: Joi.string().trim().min(1).max(80),
      phone: Joi.string().trim().allow(null, ''),
      reactivate_truck_unit_id: Joi.string().trim(),
    }),
  },

  updateTruckUnit: {
    body: Joi.object({
      name: Joi.string().trim().min(1).max(80),
      phone: Joi.string().trim().allow(null, ''),
      is_archived: Joi.boolean(),
    }).min(1),
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

  nearMe: {
    query: Joi.object({
      userLat: Joi.string().required(),
      userLong: Joi.string().required(),
      search: Joi.string().allow(''),
      distanceInMeters: Joi.number(),
      type: Joi.string().valid('ALL', 'FOOD', 'EVENT', 'all', 'food', 'event'),
      cuisineIds: Joi.string().allow(''),
      cuisines: Joi.string().allow(''),
      eventTypes: Joi.string().allow(''),
      eventVisibility: Joi.string().valid(
        'PUBLIC',
        'PRIVATE',
        'public',
        'private'
      ),
      limit: Joi.number(),
      page: Joi.number(),
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
      food_truck_count: Joi.number().integer().min(1),
      // photos: Joi.array().items(Joi.string().required()).min(0).allow(null).optional(),
      photos: Joi.alternatives().try(
        Joi.array().items(Joi.string()).min(0),
        Joi.valid(null)
      ),
      documents: Joi.alternatives().try(
        Joi.array().items(
          Joi.object({
            _id: Joi.string(),
            title: Joi.string().trim().allow(null, ''),
            document_type: Joi.string()
              .valid('PERMIT', 'LICENSE', 'INSURANCE', 'EIN', 'W9', 'OTHER')
              .default('OTHER'),
            file_url: Joi.string().uri().required(),
            file_key: Joi.string().allow(null, ''),
            original_name: Joi.string().allow(null, ''),
            mime_type: Joi.string().allow(null, ''),
            size_bytes: Joi.number().min(0).allow(null),
            uploaded_by_user_id: Joi.string().allow(null, ''),
            uploaded_at: Joi.date(),
          })
        ).min(0),
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
          isOrderingOpen: Joi.boolean(),
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
          truckUnitId: Joi.when('available', {
            is: true,
            then: Joi.string().trim().required().messages({
              'any.required': 'Please select a food truck for every active schedule row',
              'string.empty': 'Please select a food truck for every active schedule row',
            }),
            otherwise: Joi.string().trim().allow(null, ''),
          }),
        }).min(0).allow(null),
      ),
      availabilityChangeDay: scheduleChangeDayValidation,
      availabilityChangedDay: scheduleChangeDayValidation,
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
