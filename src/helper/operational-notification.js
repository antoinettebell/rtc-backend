const buildOperationalNotification = ({ form, user, employeeName, action, eventKey, now = new Date() }) => ({
  vendor_user_id: form.vendor_user_id,
  employee_internal_id: user.employee_internal_id,
  employee_name: employeeName,
  form_id: form._id,
  form_type: form.form_type,
  action,
  event_key: eventKey,
  food_truck_id: form.food_truck_id,
  truck_unit_id: form.truck_unit_id,
  location_id: form.location_id,
  occurred_at: now,
});

const runNonFatalNotificationEffect = async (effect, onError = () => {}) => {
  try {
    await effect();
    return true;
  } catch (error) {
    await onError(error);
    return false;
  }
};

module.exports = {
  buildOperationalNotification,
  runNonFatalNotificationEffect,
};
