const { Joi } = require('express-validation');

const scheduleRow = Joi.object({
  day: Joi.string().valid('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat').required(),
  enabled: Joi.boolean().required(),
  clock_in: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).when('enabled', { is: true, then: Joi.required(), otherwise: Joi.allow('') }),
  clock_out: Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).when('enabled', { is: true, then: Joi.required(), otherwise: Joi.allow('') }),
});
const scheduleAssignment = Joi.object({
  truck_unit_id: Joi.string().trim().required(),
  location_id: Joi.string().trim().required(),
  days: Joi.array().items(scheduleRow).length(7).required(),
});
const scheduleAssignments = Joi.array().items(scheduleAssignment).max(7).custom((assignments, helpers) => {
  const usedDays = new Set();
  for (const assignment of assignments) {
    for (const row of assignment.days) {
      if (!row.enabled) continue;
      if (usedDays.has(row.day)) return helpers.message({ custom: 'An employee can only have one truck and location assignment per day.' });
      usedDays.add(row.day);
    }
  }
  return usedDays.size ? assignments : helpers.message({ custom: 'Employee schedule must include at least one workday.' });
});

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
      assigned_location_id: Joi.string().trim().allow(null, ''),
      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
      first_name: Joi.string().trim().required(),
      last_name: Joi.string().trim().required(),
      zip_code: Joi.string().trim().required(),
      phone_number: Joi.string().trim().allow(null, ''),
      address_line1: Joi.string().trim().allow(null, ''),
      address_city: Joi.string().trim().allow(null, ''),
      address_state: Joi.string().trim().allow(null, ''),
      address_zip: Joi.string().trim().allow(null, ''),
      employee_id_photo_url: Joi.string().trim().required(),
      employee_tax_identifier_type: Joi.string().valid('EIN', 'SSN').allow(null, ''),
      employee_tax_identifier: Joi.string().trim().allow(null, ''),
      employee_rate: Joi.number().min(0).allow(null),
      pin: employeePin,
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
      weekly_schedule: Joi.array().items(scheduleRow).max(7),
      schedule_assignments: scheduleAssignments,
    }),
  },

  adminAdd: {
    body: Joi.object({
      vendor_user_id: Joi.string().trim().required(),
      food_truck_id: Joi.string().trim().required(),
      assigned_location_id: Joi.string().trim().allow(null, ''),
      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
      first_name: Joi.string().trim().required(),
      last_name: Joi.string().trim().required(),
      zip_code: Joi.string().trim().required(),
      phone_number: Joi.string().trim().allow(null, ''),
      address_line1: Joi.string().trim().allow(null, ''),
      address_city: Joi.string().trim().allow(null, ''),
      address_state: Joi.string().trim().allow(null, ''),
      address_zip: Joi.string().trim().allow(null, ''),
      employee_id_photo_url: Joi.string().trim().required(),
      employee_tax_identifier_type: Joi.string().valid('EIN', 'SSN').allow(null, ''),
      employee_tax_identifier: Joi.string().trim().allow(null, ''),
      employee_rate: Joi.number().min(0).allow(null),
      pin: employeePin,
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
      weekly_schedule: Joi.array().items(scheduleRow).max(7),
      schedule_assignments: scheduleAssignments,
    }),
  },

  update: {
    body: Joi.object({
      assigned_location_id: Joi.string().trim(),
      assigned_truck_unit_id: Joi.string().trim().allow(null, ''),
      first_name: Joi.string().trim(),
      last_name: Joi.string().trim(),
      zip_code: Joi.string().trim(),
      phone_number: Joi.string().trim().allow(null, ''),
      address_line1: Joi.string().trim().allow(null, ''),
      address_city: Joi.string().trim().allow(null, ''),
      address_state: Joi.string().trim().allow(null, ''),
      address_zip: Joi.string().trim().allow(null, ''),
      employee_id_photo_url: Joi.string().trim().allow(null, ''),
      employee_tax_identifier_type: Joi.string().valid('EIN', 'SSN').allow(null, ''),
      employee_tax_identifier: Joi.string().trim().allow(null, ''),
      employee_rate: Joi.number().min(0).allow(null),
      is_active: Joi.boolean(),
      is_working: Joi.boolean(),
      weekly_schedule: Joi.array().items(scheduleRow).max(7),
      schedule_assignments: scheduleAssignments,
      archive_schedule: Joi.boolean(),
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
      range: Joi.string().valid('day', 'week'),
    }),
  },

  updateShiftHistory: {
    params: Joi.object({
      id: Joi.string().trim().required(),
      sessionId: Joi.string().trim().required(),
    }),
    body: Joi.object({
      started_at: Joi.date().iso().required(),
      ended_at: Joi.date().iso().required(),
      total_break_minutes: Joi.number().min(0).required(),
      reason: Joi.string().trim().min(3).max(500).required(),
    }),
  },

  archiveShiftHistory: {
    params: Joi.object({ id: Joi.string().trim().required() }),
    body: Joi.object({
      session_ids: Joi.array().items(Joi.string().trim()).min(1).required(),
    }),
  },

  vendorShiftAction: {
    params: Joi.object({
      id: Joi.string().trim().required(),
    }),
    body: Joi.object({
      action: Joi.string().trim().uppercase().valid('END', 'OVERRIDE_START').required(),
      reason: Joi.string().trim().max(500).when('action', {
        is: 'OVERRIDE_START',
        then: Joi.required(),
        otherwise: Joi.allow(null, ''),
      }),
    }),
  },

  reviewRefundCancelRequest: {
    body: Joi.object({
      request_status: Joi.string().valid('APPROVED', 'REJECTED').required(),
      vendor_response_notes: Joi.string().trim().allow(null, ''),
    }),
  },
};
