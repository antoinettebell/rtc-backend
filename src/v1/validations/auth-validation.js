const { Joi } = require('express-validation');

module.exports = {
  auth: {
    body: Joi.object({
      email: Joi.string().required().lowercase().trim(),
      password: Joi.string().required().trim(),
    }),
  },

  register: {
    body: Joi.object({
      firstName: Joi.string().required().min(2).trim(),
      lastName: Joi.string().trim(),
      profilePic: Joi.string().trim(),
      email: Joi.string().required().lowercase().trim(),
      countryCode: Joi.string().required().trim(),
      mobileNumber: Joi.string().required().trim(),
      password: Joi.string().required().min(8).max(16).trim(),
      subscribedForOffGrid:Joi.boolean().optional(),
    }),
  },

  registerVendor: {
    body: Joi.object({
      firstName: Joi.string().required().min(2).trim(),
      lastName: Joi.string().trim(),

      planId: Joi.string().trim(),
      profilePic: Joi.string().trim(),

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
      foodTruck: Joi.object({
        name: Joi.string().required().min(2).trim(),
        ein: Joi.string().allow(null),
        // snn: Joi.string().allow(null),
        ssn: Joi.string().allow(null),
        facebookLink: Joi.string(),
        instagramLink: Joi.string(),
        infoType: Joi.string().valid('truck', 'caterer').required().trim(),
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
              )
              .required(),
            mediaUrl: Joi.string().required(),
          })
        ),
      }).required(),
      email: Joi.string().required().lowercase().trim(),
      countryCode: Joi.string().required().trim(),
      mobileNumber: Joi.string().required().trim(),
      password: Joi.string().required().min(8).max(16).trim(),
      subscribedForOffGrid:Joi.boolean().optional(),

    }),
  },

  forgotPassword: {
    body: Joi.object({
      email: Joi.string().required().lowercase().trim(),
      userType: Joi.string()
        .valid('SUPER_ADMIN', 'VENDOR', 'CUSTOMER')
        .required()
        .trim(),
      forFe: Joi.boolean(),
    }),
  },

  changePassword: {
    body: Joi.object({
      token: Joi.string().required().lowercase().trim(),
      password: Joi.string().required().min(8).max(16).trim(),
    }),
  },

  verifyOTP: {
    body: Joi.object({
      otpVerificationToken: Joi.string().required().trim(),
      otp: Joi.string().required().min(6).max(6),
    }),
  },

  resendOTP: {
    body: Joi.object({
      otpVerificationToken: Joi.string().required().trim(),
      email: Joi.string().required().lowercase().trim(),
    }),
  },

  validateToken: {
    query: Joi.object({
      token: Joi.string().required().lowercase().trim(),
    }),
  },
  
 validateChangePasswordToken: {
    query: Joi.object({
      token: Joi.string().required().trim(),
    }),
  },
};
