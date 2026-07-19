const { Joi } = require('express-validation');

const employeePin = Joi.string()
  .trim()
  .pattern(/^\d{4}$/)
  .required()
  .messages({
    'string.pattern.base': 'PIN must be exactly 4 digits',
  });
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
      archivedOnly: Joi.boolean(),
      foodTruckId: Joi.string().trim(),
    }),
  },

  adminList: {
    query: Joi.object({
      vendorUserId: Joi.string().trim().required(),
      foodTruckId: Joi.string().trim(),
      includeArchived: Joi.boolean(),
      archivedOnly: Joi.boolean(),
    }),
  },

  add: {
    body: Joi.object({
      food_truck_id: Joi.string().trim().required(),
      assigned_location_id: Joi.string().trim().required(),
	      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
	      first_name: Joi.string().trim().required(),
	      last_name: Joi.string().trim().required(),
      zip_code: Joi.string().trim().required(),
      employee_rate: Joi.number().min(0).allow(null),
      pin: employeePin,
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
    }),
  },

  adminAdd: {
    body: Joi.object({
      vendor_user_id: Joi.string().trim().required(),
      food_truck_id: Joi.string().trim().required(),
      assigned_location_id: Joi.string().trim().required(),
	      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
	      first_name: Joi.string().trim().required(),
	      last_name: Joi.string().trim().required(),
      zip_code: Joi.string().trim().required(),
      employee_rate: Joi.number().min(0).allow(null),
      pin: employeePin,
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
    }),
  },

  update: {
    body: Joi.object({
      assigned_location_id: Joi.string().trim(),
	      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
	      first_name: Joi.string().trim(),
      last_name: Joi.string().trim(),
      zip_code: Joi.string().trim(),
      employee_rate: Joi.number().min(0).allow(null),
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
    }).min(1),
  },

  resetPin: {
    body: Joi.object({
      pin: employeePin,
    }),
  },

  adminResetPin: {
    body: Joi.object({
      resetUrl: Joi.string().trim().allow(null, ''),
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
      truckUnitId: Joi.string().trim(),
      limit: Joi.number(),
    }),
  },

  shiftHistory: {
    params: Joi.object({
      id: Joi.string().trim().required(),
    }),
    query: Joi.object({
      range: Joi.string().valid('week', 'month'),
    }),
  },

  vendorShiftAction: {
    params: Joi.object({
      id: Joi.string().trim().required(),
    }),
    body: Joi.object({
      action: Joi.string().trim().uppercase().valid('END', 'REOPEN').required(),
    }),
  },

  reviewRefundCancelRequest: {
    body: Joi.object({
      request_status: Joi.string().valid('APPROVED', 'REJECTED').required(),
      vendor_response_notes: Joi.string().trim().allow(null, ''),
    }),
  },
};
