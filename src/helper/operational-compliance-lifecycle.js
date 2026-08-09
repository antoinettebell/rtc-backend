const buildEmployeeFormIdentity = ({ scope, type }) => (
  type === 'INVENTORY'
    ? {
        truck_unit_id: scope.truck_unit_id,
        location_id: scope.location_id,
      }
    : {
        employee_internal_id: scope.employee_internal_id,
        employee_session_id: scope.employee_session_id,
        truck_unit_id: scope.truck_unit_id,
        location_id: scope.location_id,
      }
);

const buildFreshChecklistDraft = ({ scope, type, employeeName, checklistItems }) => ({
  vendor_user_id: scope.vendor_user_id,
  food_truck_id: scope.food_truck_id,
  ...buildEmployeeFormIdentity({ scope, type }),
  form_type: type,
  status: 'DRAFT',
  prepared_by_name: employeeName,
  initials: '',
  truck_unit: scope.truck_unit_label || '',
  location_label: scope.location_label || '',
  checklist_items: checklistItems.map((item) => ({
    ...item,
    completed: false,
    notes: '',
  })),
});

const isEmployeeFormAssignmentMatch = ({ form, scope }) =>
  String(form.truck_unit_id || '') === String(scope.truck_unit_id || '') &&
  String(form.location_id || '') === String(scope.location_id || '') &&
  (form.form_type === 'INVENTORY' ||
    (form.employee_internal_id === scope.employee_internal_id &&
      form.employee_session_id === scope.employee_session_id));

const getEmployeeEditablePayload = (payload = {}) =>
  ['initials', 'form_date', 'inventory_items', 'checklist_items'].reduce(
    (result, field) => (
      payload[field] === undefined
        ? result
        : { ...result, [field]: payload[field] }
    ),
    {}
  );

module.exports = {
  buildEmployeeFormIdentity,
  buildFreshChecklistDraft,
  isEmployeeFormAssignmentMatch,
  getEmployeeEditablePayload,
};
