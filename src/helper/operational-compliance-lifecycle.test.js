const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildActorAuditIdentity,
  buildEmployeeFormIdentity,
  buildFreshChecklistDraft,
  buildVendorChecklistIdentity,
  isEmployeeFormAssignmentMatch,
  getEmployeeEditablePayload,
} = require('./operational-compliance-lifecycle');

const scope = {
  vendor_user_id: 'vendor-1',
  food_truck_id: 'food-truck-1',
  employee_internal_id: 'employee-1',
  employee_session_id: 'session-new',
  truck_unit_id: 'truck-1',
  location_id: 'location-1',
  truck_unit_label: 'Truck One',
  location_label: '1 Main Street',
};
const template = [{ area: 'Truck', task: 'Inspect', completed: true, notes: 'old note' }];
for (const type of ['OPENING_CHECKLIST', 'CLOSING_CHECKLIST']) {
  const draft = buildFreshChecklistDraft({
    scope,
    type,
    employeeName: 'Current Employee',
    employeeInitials: 'CE',
    checklistItems: template,
  });
  assert.equal(draft.employee_session_id, 'session-new');
  assert.equal(draft.prepared_by_name, 'Current Employee');
  assert.equal(draft.initials, 'CE');
  assert.equal(draft.truck_unit, 'Truck One');
  assert.equal(draft.location_label, '1 Main Street');
  assert.equal(draft.checklist_items[0].completed, false);
  assert.equal(draft.checklist_items[0].notes, '');
}
assert.deepEqual(buildEmployeeFormIdentity({ scope, type: 'INVENTORY' }), {
  employee_internal_id: 'employee-1',
  employee_session_id: 'session-new',
  truck_unit_id: 'truck-1',
  location_id: 'location-1',
});
assert.deepEqual(buildVendorChecklistIdentity(), {
  employee_internal_id: null,
  employee_session_id: null,
});
assert.deepEqual(buildActorAuditIdentity({
  userType: 'VENDOR',
  firstName: 'Antoinette',
  lastName: 'Bell',
}), { prepared_by_name: 'Vendor', initials: 'AB' });
assert.deepEqual(buildActorAuditIdentity({
  userType: 'EMPLOYEE',
  first_name: 'Current',
  last_name: 'Employee',
}), { prepared_by_name: 'Current Employee', initials: 'CE' });
assert.equal(isEmployeeFormAssignmentMatch({
  scope,
  form: { ...scope, form_type: 'OPENING_CHECKLIST' },
}), true);
assert.equal(isEmployeeFormAssignmentMatch({
  scope,
  form: { ...scope, employee_session_id: 'old-session', form_type: 'OPENING_CHECKLIST' },
}), false);
const craftedPayload = getEmployeeEditablePayload({
  initials: 'CE',
  prepared_by_name: 'Impersonated Vendor',
  employee_internal_id: 'other-employee',
  employee_session_id: 'other-session',
  truck_unit: 'Other Truck',
  truck_unit_id: 'other-truck',
  location_id: 'other-location',
  vendor_user_id: 'other-vendor',
  food_truck_id: 'other-food-truck',
});
assert.deepEqual(craftedPayload, {});
assert.equal(isEmployeeFormAssignmentMatch({
  scope,
  form: { ...scope, location_id: 'other-location', form_type: 'INVENTORY' },
}), false);
const authenticateSource = fs.readFileSync(
  path.join(__dirname, '../middleware/authenticate.js'),
  'utf8'
);
const exemptRoutesBlock = authenticateSource.match(
  /const EMPLOYEE_SHIFT_EXEMPT_ROUTES = \[[\s\S]*?\];/
)?.[0] || '';
assert.equal(
  exemptRoutesBlock.includes('/operational-compliance'),
  false,
  'operations routes must require an active shift and must not be break-exempt'
);
const serviceSource = fs.readFileSync(
  path.join(__dirname, '../v1/services/operational-compliance-form-service.js'),
  'utf8'
);
assert.match(serviceSource, /Employees cannot view archived inventory forms/);
assert.match(serviceSource, /form_type: \{ \$ne: 'INVENTORY' \}.*status: \{ \$ne: 'CANCELLED' \}/);
assert.match(serviceSource, /Only the vendor can unlock a submitted form/);
assert.match(serviceSource, /form\.status !== 'DRAFT'/);
assert.match(serviceSource, /buildNextInventoryItems/);
assert.match(serviceSource, /buildVendorChecklistIdentity/);
assert.match(serviceSource, /getEmployeeChecklistSeed/);
assert.match(serviceSource, /status: 'SUBMITTED'/);
assert.match(serviceSource, /else if \(!existing\.last_edited_at\)/);
assert.doesNotMatch(
  serviceSource.match(/const editableFields = \[[\s\S]*?\];/)?.[0] || '',
  /prepared_by_name|initials/,
  'audit identity fields must never be accepted from a form payload'
);
console.log('operational compliance lifecycle tests passed');
