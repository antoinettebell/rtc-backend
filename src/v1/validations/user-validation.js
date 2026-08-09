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
      isEventCoordinator: Joi.boolean(),
      eventCoordinatorCompanyName: Joi.when('isEventCoordinator', {
        is: true,
        then: Joi.string().trim().required(),
        otherwise: Joi.string().trim().allow(null, ''),
      }),
      eventCoordinatorCompanyAddress: Joi.string().trim().allow(null, ''),
      eventCoordinatorEin: Joi.when('isEventCoordinator', {
        is: true,
        then: Joi.string().trim().allow(null, ''),
        otherwise: Joi.string().trim().allow(null, ''),
      }),
      eventCoordinatorTaxIdType: Joi.string().valid('EIN', 'SSN').allow(null, ''),
      eventCoordinatorTaxId: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressLine1: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressLine2: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressCity: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressState: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressZip: Joi.string().trim().allow(null, ''),
      eventCoordinatorAddressCountry: Joi.string().trim().max(100).allow(null, ''),
      eventCoordinatorAddressLatitude: Joi.number().min(-90).max(90).allow(null, ''),
      eventCoordinatorAddressLongitude: Joi.number().min(-180).max(180).allow(null, ''),
      eventCoordinatorFormattedAddress: Joi.string().trim().allow(null, ''),
      eventCoordinatorPlaceId: Joi.string().trim().allow(null, ''),
      eventCoordinatorPaymentPreference: Joi.string()
        .valid('CASHAPP', 'PAYPAL', 'VENMO', 'ACH', 'CHECK')
        .allow(null, ''),
      eventCoordinatorPaymentHandle: Joi.string().trim().allow(null, ''),
      eventCoordinatorPaymentQrCodeUrl: Joi.string().uri().allow(null, ''),
      eventCoordinatorDirectDepositRoutingNumber: Joi.string().trim().allow(null, ''),
      eventCoordinatorDirectDepositAccountNumber: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankName: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankAddressLine1: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankAddressLine2: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankCity: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankState: Joi.string().trim().allow(null, ''),
      eventCoordinatorBankPostal: Joi.string().trim().allow(null, ''),
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
      paymentMethod: Joi.string()
        .valid('CASHAPP', 'PAYPAL', 'VENMO', 'ACH', 'CHECK')
        .required(),
      paymentQrCodeUrl: Joi.when('paymentMethod', {
        is: Joi.valid('CASHAPP', 'PAYPAL', 'VENMO'),
        then: Joi.string().uri().required(),
        otherwise: Joi.string().allow('', null).optional(),
      }),
      bankName: Joi.when('paymentMethod', {
        is: Joi.valid('ACH', 'CHECK'),
        then: Joi.string().required(),
        otherwise: Joi.string().allow('').optional(),
      }),
      accountNumber: Joi.when('paymentMethod', {
        is: Joi.valid('ACH', 'CHECK'),
        then: Joi.string().min(8).required(),
        otherwise: Joi.string().allow('').optional(),
      }),
      routingNumber: Joi.when('paymentMethod', {
        is: Joi.valid('ACH', 'CHECK'),
        then: Joi.string().length(9).required(),
        otherwise: Joi.string().allow('').optional(),
      }),
      accountType: Joi.when('paymentMethod', {
        is: Joi.valid('ACH', 'CHECK'),
        then: Joi.string().valid('CHECKING', 'SAVINGS').required(),
        otherwise: Joi.string().allow('').optional(),
      }),
      //new fileds
      currency: Joi.string()
        .uppercase()
        .length(3)
        .pattern(/^[A-Z]{3}$/)
        .required(),

      remittanceEmail: Joi.string().optional().lowercase().trim(),

      bankAddressLine1: Joi.when('paymentMethod', {
        is: Joi.valid('ACH', 'CHECK'),
        then: Joi.string().trim().required(),
        otherwise: Joi.string().allow('').optional(),
      }),
      bankAddressLine2: Joi.string().trim().allow('').optional(),
      bankCity: Joi.when('paymentMethod', { is: Joi.valid('ACH', 'CHECK'), then: Joi.string().trim().required(), otherwise: Joi.string().allow('').optional() }),
      bankState: Joi.when('paymentMethod', { is: Joi.valid('ACH', 'CHECK'), then: Joi.string().trim().required(), otherwise: Joi.string().allow('').optional() }),
      bankPostal: Joi.when('paymentMethod', { is: Joi.valid('ACH', 'CHECK'), then: Joi.string().trim().required(), otherwise: Joi.string().allow('').optional() }),

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
