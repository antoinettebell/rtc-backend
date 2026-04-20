const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      limit: Joi.number(),
      page: Joi.number(),
      userType: Joi.string().valid('CUSTOMER', 'VENDOR').required(),
      status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED'),
      profileComplete: Joi.string().valid('COMPLETE', 'INCOMPLETE'),
      inactive: Joi.string().valid('inactive'),
    }),
  },

  update: {
    body: Joi.object({
      firstName: Joi.string().min(2).trim(),
      lastName: Joi.string().min(2).trim(),
      profilePic: Joi.string().trim(),
      countryCode: Joi.string().trim(),
      mobileNumber: Joi.string().trim(),
      password: Joi.string().min(8).max(16).trim(),
      addressLine1: Joi.string().trim().optional(),
      addressLine2: Joi.string().trim().optional(),
      addressCity: Joi.string().trim().optional(),
      addressState: Joi.string().trim().optional(),
      addressCountry: Joi.string().trim().optional(),
      addressPostal: Joi.string().trim().optional(),
      // mailing: Joi.object({
      //   address: Joi.string().trim().required(),
      //   city: Joi.string().trim().required(),
      //   state: Joi.string().trim().required(),
      //   country: Joi.string().trim().required(),
      //   zipcode: Joi.string().trim().required(),
      // }),
    }),
  },

  changePassword: {
    body: Joi.object({
      currentPassword: Joi.string().required().trim(),
      newPassword: Joi.string().required().trim(),
    }),
  },

  status: {
    body: Joi.object({
      inactive: Joi.boolean().required(),
    }),
  },

  requestStatus: {
    body: Joi.object({
      requestStatus: Joi.string().valid('APPROVED', 'REJECTED').required(),
      reasonForRejection: Joi.string().allow('', null),
    }),
  },

  addAddress: {
    body: Joi.object({
      title: Joi.string().required(),
      address: Joi.string().required(),
      lat: Joi.string().required(),
      long: Joi.string().required(),
    }),
  },

  updateAddress: {
    body: Joi.object({
      title: Joi.string(),
      address: Joi.string(),
      lat: Joi.string(),
      long: Joi.string(),
    }),
  },

  setFCMToken: {
    body: Joi.object({
      token: Joi.string().required(),
      deviceId: Joi.string().required(),
    }),
  },

  updateFCMToken: {
    body: Joi.object({
      token: Joi.string().required(),
    }),
  },

  sendNotification: {
    body: Joi.object({
      userList: Joi.array().items(Joi.string().required()),
      title: Joi.string().required(),
      description: Joi.string().required(),
    }),
  },

  bankDetail: {
    body: Joi.object({
      accountHolderName: Joi.string().required(),
      bankName: Joi.string().required(),
      accountNumber: Joi.string().min(8).required(),
      routingNumber: Joi.string().min(9).required(),
      accountType: Joi.string().valid('CHECKING', 'SAVINGS').required(),
      //new fileds
      currency: Joi.string()
        .uppercase()
        .length(3)
        .pattern(/^[A-Z]{3}$/)
        .required(),

      remittanceEmail: Joi.string().optional().lowercase().trim(),

      bankAddressLine1: Joi.string().trim().optional(),
      bankAddressLine2: Joi.string().trim().allow('').optional(),
      bankCity: Joi.string().trim().optional(),
      bankState: Joi.string().trim().optional(),
      bankPostal: Joi.string().trim().optional(),

      // swiftCode: Joi.when('currency', {
      //   is: Joi.valid('USD'),
      //   then: Joi.string().required(),
      //   otherwise: Joi.string().optional().allow(null, ''),
      // }),

      // iban: Joi.when('currency', {
      //   is: Joi.valid('USD'),
      //   then: Joi.string().required(),
      //   otherwise: Joi.string().optional().allow(null, ''),
      // }),

      // swiftCode: Joi.when('currency', {
      //   is: Joi.valid('USD'),
      //   then: Joi.string().optional().allow(null, ''),
      //   otherwise: Joi.string().required().messages({
      //     'any.required': 'Swift Code is required when currency is not USD',
      //   }),
      // }),

      // iban: Joi.when('currency', {
      //   is: Joi.valid('USD'),
      //   then: Joi.string().optional().allow(null, ''),
      //   otherwise: Joi.string().required().messages({
      //     'any.required': 'IBAN is required when currency is not USD',
      //   }),
      // }),

      paymentMethod: Joi.string()
        .valid('ACH', 'CHECK', 'ECHECK', 'PAYPAL', 'WIRE')
        .optional(),
    }),
  },

  adminSendNotification: {
    body: Joi.object({
      recipientType: Joi.string()
        .valid('ALL_USERS', 'ALL_VENDORS', 'ALL_CUSTOMERS')
        .required(),
      title: Joi.string().required(),
      description: Joi.string().required(),
    }),
  },

  adminNotificationList: {
    query: Joi.object({
      limit: Joi.number(),
      page: Joi.number(),
      search: Joi.string().trim(),
    }),
  },
};
