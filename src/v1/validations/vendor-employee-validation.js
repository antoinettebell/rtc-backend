const { Joi } = require('express-validation');

const employeePin = Joi.string().trim().min(4).max(12).required();
const reasonCode = Joi.string()
  .valid(
    'customer changed mind',
    'wrong item entered',
    'duplicate order',
    'payment issue',
    'food unavailable',
    'customer complaint',
    'other'
  );

module.exports = {
  list: {
    query: Joi.object({
      includeArchived: Joi.boolean(),
    }),
  },

  add: {
    body: Joi.object({
      food_truck_id: Joi.string().trim().required(),
      assigned_location_id: Joi.string().trim().required(),
      first_name: Joi.string().trim().required(),
      last_name: Joi.string().trim().required(),
      zip_code: Joi.string().trim().required(),
      pin: employeePin,
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
    }),
  },

  update: {
    body: Joi.object({
      assigned_location_id: Joi.string().trim(),
      first_name: Joi.string().trim(),
      last_name: Joi.string().trim(),
      zip_code: Joi.string().trim(),
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
    }).min(1),
  },

  resetPin: {
    body: Joi.object({
      pin: employeePin,
    }),
  },

  submitRefundCancelRequest: {
    body: Joi.object({
      order_id: Joi.string().trim().required(),
      request_type: Joi.string().valid('REFUND', 'CANCEL').required(),
      reason_code: reasonCode.required(),
      employee_notes: Joi.string().trim().allow(null, ''),
    }),
  },

  listRefundCancelRequests: {
    query: Joi.object({
      foodTruckId: Joi.string().trim(),
      orderId: Joi.string().trim(),
      status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED'),
      employeeInternalId: Joi.string().trim(),
      locationId: Joi.string().trim(),
      limit: Joi.number(),
    }),
  },

  reviewRefundCancelRequest: {
    body: Joi.object({
      request_status: Joi.string().valid('APPROVED', 'REJECTED').required(),
      vendor_response_notes: Joi.string().trim().allow(null, ''),
    }),
  },
};
