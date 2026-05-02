const { Joi } = require('express-validation');

module.exports = {
  list: {
    query: Joi.object({
      search: Joi.string().trim(),
      advance: Joi.boolean(),
      limit: Joi.number(),
      page: Joi.number(),
      orderStatus: Joi.string(),
    }),
  },
  paymentTransactionslist: {
    query: Joi.object({
      search: Joi.string().allow('').trim(),
      limit: Joi.number().default(10),
      page: Joi.number().default(1),
      transactionsType: Joi.string(),
      // allow "true", "false", true, false, null
      status: Joi.alternatives()
        .try(Joi.boolean(), Joi.string().valid('true', 'false'))
        .allow(null, ''),

      startDate: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .allow(null, ''),

      endDate: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .allow(null, ''),
    }),
  },
  add: {
    body: Joi.object({
      foodTruckId: Joi.string().required(),
      locationId: Joi.string().required(),
      deliveryTime: Joi.string(),
      deliveryDate: Joi.string(),
      fulfillmentType: Joi.string().valid('PICKUP', 'DELIVERY').default('PICKUP'),
      deliveryAddress: Joi.string().allow(null, ''),
      availabilityId: Joi.string(),
      orderSource: Joi.string().valid('CUSTOMER_APP', 'VENDOR_POS').default('CUSTOMER_APP'),
      guestCustomer: Joi.object({
        phone: Joi.string().allow(null, ''),
      }).optional(),

      paymentMethod: Joi.string()
        .valid('COD', 'CASH', 'APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY')
        .default('COD'),
      paymentStatus: Joi.string()
        .valid('PENDING', 'PAID', 'FAILED', 'REFUNDED')
        .default('PENDING'),
      transactionId: Joi.string().when('paymentMethod', {
        is: Joi.valid('COD', 'CASH'),
        then: Joi.string().optional().allow(null, ''),
        otherwise: Joi.string().required(),
      }),

      authCode: Joi.string().when('paymentMethod', {
        is: Joi.valid('COD', 'CASH'),
        then: Joi.string().optional().allow(null, ''),
        otherwise: Joi.string().required(),
      }),
      invoiceNumber: Joi.string().optional(),
      accountNumber: Joi.string().optional(),
      accountType: Joi.string().optional(),

      couponId: Joi.string(),
      taxAmount: Joi.number(),
      tax: Joi.number(),
      deliveryFee: Joi.number(),
      tip: Joi.number(),
      tips: Joi.number(),
      tipsAmount: Joi.number().default(0),
      subtotal: Joi.number(),
      totalOrderCost: Joi.number(),

      items: Joi.array()
        .items(
          Joi.object({
            menuItemId: Joi.string().required(),
            customization: Joi.string(),
            selectedFlavors: Joi.array().items(Joi.string().trim()),
            selectedToppings: Joi.array().items(Joi.string().trim()),
            selectedDiscountFlavors: Joi.array().items(Joi.string().trim()),
            selectedDiscountToppings: Joi.array().items(Joi.string().trim()),
            qty: Joi.number().min(1).required(),
            comboItems: Joi.array().items(
              Joi.object({
                comboMenuItemId: Joi.string().required(),
                qty: Joi.number().min(1)
              })
            ).optional()
          }).required()
        )
        .required(),
    }),
  },

  update: {
    body: Joi.object({
      orderStatus: Joi.string()
        .valid(
          'CANCEL',
          'PLACED',
          'ACCEPTED',
          'REJECTED',
          'PREPARING',
          'READY_FOR_PICKUP',
          'COMPLETED'
        )
        .trim(),
      cancelReason: Joi.string().when('orderStatus', {
        is: 'CANCEL',
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
      pickupTime: Joi.string().when('orderStatus', {
        is: 'PREPARING',
        then: Joi.required(),
        otherwise: Joi.forbidden(),
      }),
      paymentStatus: Joi.string()
        .valid('PENDING', 'PAID', 'FAILED', 'REFUNDED')
        .optional(),
    }),
  },

  vendorEarnings: {
    query: Joi.object({
      foodTruckId: Joi.string().required(),
      startDate: Joi.date().iso(),
      endDate: Joi.date().iso(),
    }),
  },
  vendorDashboard: {
    query: Joi.object({
      foodTruckId: Joi.string().required(),
    }),
  },
  validateOrder: {
    body: Joi.object({
      foodTruckId: Joi.string().required(),
      locationId: Joi.string().required(),
      deliveryTime: Joi.string(),
      deliveryDate: Joi.string(),
      fulfillmentType: Joi.string().valid('PICKUP', 'DELIVERY').default('PICKUP'),
      deliveryAddress: Joi.string().allow(null, ''),
      availabilityId: Joi.string(),
      orderSource: Joi.string().valid('CUSTOMER_APP', 'VENDOR_POS').default('CUSTOMER_APP'),
      guestCustomer: Joi.object({
        phone: Joi.string().allow(null, ''),
      }).optional(),
      paymentMethod: Joi.string()
        .valid('COD', 'CASH', 'APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY')
        .optional(),
      couponId: Joi.string(),
      taxAmount: Joi.number(),
      tax: Joi.number(),
      deliveryFee: Joi.number(),
      tip: Joi.number(),
      tips: Joi.number(),
      tipsAmount: Joi.number().default(0),
      subtotal: Joi.number(),
      totalOrderCost: Joi.number(),
      items: Joi.array()
        .items(
          Joi.object({
            menuItemId: Joi.string().required(),
            customization: Joi.string(),
            selectedFlavors: Joi.array().items(Joi.string().trim()),
            selectedToppings: Joi.array().items(Joi.string().trim()),
            selectedDiscountFlavors: Joi.array().items(Joi.string().trim()),
            selectedDiscountToppings: Joi.array().items(Joi.string().trim()),
            qty: Joi.number().min(1).required(),
            comboItems: Joi.array().items(
              Joi.object({
                comboMenuItemId: Joi.string().required(),
                qty: Joi.number().min(1)
              })
            ).optional()
          }).required()
        )
        .required(),
    }),
  },
  checkout: {
    body: Joi.object({
      paymentData: Joi.alternatives()
        .try(
          Joi.object().required(), // Allow Object
          Joi.string().required() // Allow String
        )
        .required(),
      paymentMethod: Joi.string()
        .valid('APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY')
        .default('APPLE_PAY'),

      taxAmount: Joi.string().optional(),
      subTotal: Joi.string().optional(),
      amount: Joi.string().required(),
      // applePayToken: Joi.string().optional(),
      // email: Joi.string(),
      // userId: Joi.string().optional(),
    }),
  },
  refund: {
    body: Joi.object({
      orderId: Joi.string().required(),
      transactionId: Joi.string().required(),
      amount: Joi.number().required(),
    }),
  },
  Earningslist: {
    query: Joi.object({
      foodTruckId: Joi.string().required(),
      search: Joi.string().trim(),
      limit: Joi.number(),
      page: Joi.number(),
      earning_list: Joi.string()
        .valid('daily', 'weekly', 'monthly')
        .default('daily'),
      is_list: Joi.string().valid('normal', 'dessert').default('normal'),
      // startDate: Joi.string().optional(),
      // endDate: Joi.string().optional(),
      startDate: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message('startDate must be in YYYY-MM-DD format')
        .optional(),

      endDate: Joi.string()
        .pattern(/^\d{4}-\d{2}-\d{2}$/)
        .message('endDate must be in YYYY-MM-DD format')
        .optional(),
    }),
  },
};
