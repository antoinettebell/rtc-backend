const { Joi } = require('express-validation');

const paidOptionValidation = Joi.object({
  name: Joi.string().trim().required(),
  hasCost: Joi.boolean(),
  cost: Joi.number().min(0),
});

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      categoryId: Joi.string(),
      limit: Joi.number(),
      page: Joi.number(),
    }),
  },

  add: {
    body:
     Joi.object({
      name: Joi.string().min(2).trim().required(),
      description: Joi.string(),
      meatId: Joi.string(),
      meatWellness: Joi.string(),
      imgUrls: Joi.array().items(Joi.string()),
      strikePrice: Joi.number(),
      price: Joi.number().required(),
      minQty: Joi.number().min(1).required(),
      maxQty: Joi.number().min(1).required(),

      //comment code
      hasDiscount: Joi.boolean().required(),
      discountMode: Joi.string()
        .valid('CUSTOM', 'PREDEFINED')
        .when('hasDiscount', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),

      discountType: Joi.string()
      .valid('PERCENTAGE', 'FIXED', 'BOGO', 'BOGOHO')
      .when('hasDiscount', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
      discount: Joi.number(),
      discountRules: Joi.object({
        buyQty: Joi.number().min(1).required(),
        getQty: Joi.number().min(1).required(),
        discount: Joi.number().min(0).max(1).required(),
        repeatable: Joi.boolean().default(true),
      }).optional(),
      predefinedDiscountId: Joi.string()
        .trim()
        .when('discountMode', {
          is: 'PREDEFINED',
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),

      bogoItems: Joi.array()
        .items(
          Joi.object({
            itemId: Joi.string().trim().allow(null, ''),
            qty: Joi.number().min(1).required(),
            isSameItem: Joi.boolean().optional(),
          })
        )
         .when('hasDiscount', {
          is: true,
          then: Joi.when('discountType', {
            is: Joi.valid('BOGO', 'BOGOHO'),
            then: Joi.required(),
            otherwise: Joi.forbidden(),
          }),
          otherwise: Joi.forbidden(),
        }),


      preparationTime: Joi.number(),
      itemType: Joi.string().valid('INDIVIDUAL', 'COMBO').required(),
      categoryId: Joi.string().trim().required(),
      allowCustomize: Joi.boolean(),
      hasFlavors: Joi.boolean(),
      flavors: Joi.array().items(Joi.string().trim()).when('hasFlavors', {
        is: true,
        then: Joi.array().min(1).max(15).required(),
        otherwise: Joi.optional(),
      }),
      flavorOptions: Joi.array().items(paidOptionValidation).max(15),
      flavorsPerOrder: Joi.number().min(1).max(5).when('hasFlavors', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
      hasToppings: Joi.boolean(),
      toppings: Joi.array().items(Joi.string().trim()).when('hasToppings', {
        is: true,
        then: Joi.array().min(1).max(15).required(),
        otherwise: Joi.optional(),
      }),
      toppingOptions: Joi.array().items(paidOptionValidation).max(15),
      toppingsPerOrder: Joi.number().min(1).max(15).when('hasToppings', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
      newDish: Joi.boolean(),
      popularDish: Joi.boolean(),
      diet: Joi.array().items(Joi.string()),
      subItem: Joi.array()
        .items(
          Joi.object({
            menuItem: Joi.string().trim().required(),
            qty: Joi.number().min(1),
          })
        )
        .when('itemType', {
          is: 'COMBO',
          then: Joi.optional(),
          otherwise: Joi.forbidden(),
        }),
    }),
  },

  checkItems: {
    body: Joi.object({
      ids: Joi.array().items(Joi.string().trim().required()).required(),
    }),
  },

  update: {
    body: Joi.object({
      name: Joi.string().min(2).trim(),
      description: Joi.string().trim(),
      meatId: Joi.string(),
      meatWellness: Joi.string(),
      imgUrls: Joi.array().items(),
      strikePrice: Joi.number(),
      price: Joi.number(),
      available: Joi.boolean(),
      minQty: Joi.number().min(1),
      maxQty: Joi.number().min(1),
      hasDiscount: Joi.boolean().required(),
      discountMode: Joi.string()
        .valid('CUSTOM', 'PREDEFINED')
        .when('hasDiscount', {
          is: true,
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),

      discountType: Joi.string()
      .valid('PERCENTAGE', 'FIXED', 'BOGO', 'BOGOHO')
      .when('hasDiscount', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
      itemType: Joi.string().valid('INDIVIDUAL', 'COMBO').required(),
      discount: Joi.number(),
      discountRules: Joi.object({
        buyQty: Joi.number().min(1).required(),
        getQty: Joi.number().min(1).required(),
        discount: Joi.number().min(0).max(1).required(),
        repeatable: Joi.boolean().default(true),
      }).optional(),
      predefinedDiscountId: Joi.string()
        .trim()
        .when('discountMode', {
          is: 'PREDEFINED',
          then: Joi.required(),
          otherwise: Joi.forbidden(),
        }),

        bogoItems: Joi.array()
        .items(
          Joi.object({
            itemId: Joi.string().trim().allow(null, ''),
            qty: Joi.number().min(1).required(),
            isSameItem: Joi.boolean().optional(),
          })
        )
         .when('hasDiscount', {
          is: true,
          then: Joi.when('discountType', {
            is: Joi.valid('BOGO', 'BOGOHO'),
            then: Joi.required(),
            otherwise: Joi.forbidden(),
          }),
          otherwise: Joi.forbidden(),
        }),
      preparationTime: Joi.number(),
      categoryId: Joi.string(),
      allowCustomize: Joi.boolean(),
      hasFlavors: Joi.boolean(),
      flavors: Joi.array().items(Joi.string().trim()).when('hasFlavors', {
        is: true,
        then: Joi.array().min(1).max(15).required(),
        otherwise: Joi.optional(),
      }),
      flavorOptions: Joi.array().items(paidOptionValidation).max(15),
      flavorsPerOrder: Joi.number().min(1).max(5).when('hasFlavors', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
      hasToppings: Joi.boolean(),
      toppings: Joi.array().items(Joi.string().trim()).when('hasToppings', {
        is: true,
        then: Joi.array().min(1).max(15).required(),
        otherwise: Joi.optional(),
      }),
      toppingOptions: Joi.array().items(paidOptionValidation).max(15),
      toppingsPerOrder: Joi.number().min(1).max(15).when('hasToppings', {
        is: true,
        then: Joi.required(),
        otherwise: Joi.optional(),
      }),
      newDish: Joi.boolean(),
      popularDish: Joi.boolean(),
      diet: Joi.array().items(Joi.string()),
      subItem: Joi.array().items(
        Joi.object({
          menuItem: Joi.string().trim().required(),
          qty: Joi.number().min(1),
        })
      ),
    }),
  },
  availability:{
      body: Joi.object({
      available: Joi.boolean(),
    }),
}
};
