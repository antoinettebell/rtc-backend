const assert = require('assert');
const service = require('./operational-compliance-form-service');
const { OperationalComplianceFormModel } = require('../../models');

const makeItems = (values) => {
  const list = values;
  list.create = (value) => ({ ...value, _id: `item-${list.length + 1}`, actions: [...(value.actions || [])] });
  list.id = (id) => list.find((item) => String(item._id) === String(id));
  return list;
};

const user = { _id: '507f1f77bcf86cd799439011', userType: 'VENDOR', firstName: 'Vendor', lastName: 'Owner' };
const originalGetter = service.getVendorInventoryItem;
const originalScopedGetter = service.getScopedForm;
const originalVendorFormGetter = service.getVendorInventoryForm;
const originalScopeGetter = service.getScope;
const originalSeedGetter = service.getEmployeeInventorySeed;
const originalFindOneAndUpdate = OperationalComplianceFormModel.findOneAndUpdate;
const originalUpdateOne = OperationalComplianceFormModel.updateOne;

(async () => {
  const active = {
    _id: 'item-1',
    item_name: 'Chicken',
    current_quantity: 3,
    beginning_quantity: 8,
    max_quantity: 10,
    reorder_quantity: 7,
    use_by_date: new Date('2026-09-14T12:00:00.000Z'),
    lifecycle_status: 'ACTIVE',
    lineage_id: 'line-1',
    actions: [],
    toObject() { return { ...this, toObject: undefined }; },
  };
  const form = {
    inventory_items: makeItems([active]),
    async save() { this.saved = true; },
  };
  service.getVendorInventoryItem = async () => ({ form, item: active });

  const draft = await service.updateInventoryItem({
    user,
    id: 'form-1',
    itemId: active._id,
    payload: { current_quantity: 2, use_by_date: '2026-09-14T12:00:00.000Z', close_count_draft: true },
  });
  assert.equal(active.current_quantity, 3, 'saving a close draft must not change active inventory');
  assert.equal(draft.item.pending_close_draft.current_quantity, 2);

  const result = await service.closeInventoryCount({
    user,
    id: 'form-1',
    itemId: active._id,
    payload: {
      ...draft.item.pending_close_draft,
      date_purchased: '2026-09-14T12:00:00.000Z',
      use_by_date: '2026-10-14T12:00:00.000Z',
      beginning_quantity: 6,
      current_quantity: 6,
      max_quantity: 6,
    },
  });
  assert.equal(result.current.lifecycle_status, 'ACTIVE', 'receiving reordered products must preserve the existing lot');
  assert.equal(result.current.beginning_quantity, 8, 'existing lot history must not be rewritten');
  assert.equal(result.current.max_quantity, 10, 'resolving a reorder must not lower the historical maximum');
  assert.equal(result.current.reorder_quantity, 0);
  assert.ok(result.current.reorder_resolved_at);
  assert.equal(result.next.lifecycle_status, 'ACTIVE');
  assert.equal(result.next.beginning_quantity, 6);
  assert.equal(result.next.current_quantity, 6);
  assert.equal(result.next.max_quantity, 6);
  assert.equal(result.next.reorder_quantity, 0);
  assert.equal(new Date(result.next.use_by_date).toISOString().slice(0, 10), '2026-10-14');
  assert.equal(form.saved, true);

  const noReorderItem = {
    ...active,
    _id: 'no-reorder',
    current_quantity: 10,
    max_quantity: 10,
    reorder_quantity: 0,
    reorder_resolved_at: null,
  };
  service.getVendorInventoryItem = async () => ({ form, item: noReorderItem });
  await assert.rejects(
    () => service.closeInventoryCount({ user, id: 'form-1', itemId: noReorderItem._id, payload: {} }),
    (error) => error.code === 409 && /No reorder/.test(error.message)
  );

  const current = {
    _id: 'current-1',
    item_name: 'Chicken',
    current_quantity: 4,
    beginning_quantity: 8,
    max_quantity: 10,
    reorder_quantity: 6,
    use_by_date: new Date('2026-10-01T12:00:00.000Z'),
    lifecycle_status: 'ACTIVE',
    lineage_id: 'line-review',
    actions: [],
  };
  const vendorForm = {
    inventory_items: makeItems([current]),
    async save() { this.saved = true; },
  };
  const source = {
    _id: '507f1f77bcf86cd799439012',
    form_type: 'INVENTORY',
    status: 'SUBMITTED',
    employee_internal_id: 'employee-1',
    truck_unit_id: 'truck-1',
    truck_unit: 'Truck One',
    inventory_review_action: null,
    inventory_items: [{
      _id: 'review-1',
      item_name: 'Chicken',
      current_quantity: 3,
      beginning_quantity: 4,
      max_quantity: 10,
      use_by_date: new Date('2026-10-01T12:00:00.000Z'),
      lifecycle_status: 'ACTIVE',
      lineage_id: 'line-review',
      source_item_id: 'current-1',
      employee_modified_at: new Date('2026-09-14T12:00:00.000Z'),
    }],
    async save() { this.saved = true; },
  };
  service.getScopedForm = async () => source;
  service.getVendorInventoryForm = async () => vendorForm;
  OperationalComplianceFormModel.findOneAndUpdate = async () => source;
  OperationalComplianceFormModel.updateOne = async () => ({ acknowledged: true });
  await service.reviewEmployeeInventory({
    user,
    id: source._id,
    payload: { action: 'UPDATED', inventory_items: source.inventory_items },
  });
  assert.equal(vendorForm.inventory_items.length, 1, 'update must not duplicate a matching item');
  assert.equal(current.current_quantity, 3);
  assert.equal(current.lifecycle_status, 'ACTIVE');
  assert.equal(current.actions.at(-1).action, 'ITEM_UPDATED');
  assert.equal(source.inventory_review_action, 'UPDATED');
  assert.equal(source.status, 'ARCHIVED', 'a completed employee review must release the shift draft slot');

  source.inventory_review_action = null;
  source.status = 'SUBMITTED';
  await service.reviewEmployeeInventory({
    user,
    id: source._id,
    payload: {
      action: 'CLOSED_INTO_INVENTORY',
      reorder_items: [{
        ...source.inventory_items[0],
        date_purchased: '2026-10-02T12:00:00.000Z',
        use_by_date: '2026-11-02T12:00:00.000Z',
        beginning_quantity: 5,
        current_quantity: 5,
        max_quantity: 5,
      }],
    },
  });
  const replacement = vendorForm.inventory_items.find((item) => item !== current && item.lifecycle_status === 'ACTIVE');
  assert.equal(current.lifecycle_status, 'ACTIVE', 'receiving reordered products must preserve the prior active item');
  assert.equal(current.current_quantity, 3, 'the employee count updates the current quantity');
  assert.equal(current.max_quantity, 10, 'the original maximum remains historical truth');
  assert.equal(current.reorder_quantity, 0);
  assert.ok(current.reorder_resolved_at);
  assert.equal(replacement.beginning_quantity, 5);
  assert.equal(replacement.current_quantity, 5);
  assert.equal(replacement.max_quantity, 5);
  assert.equal(new Date(replacement.use_by_date).toISOString().slice(0, 10), '2026-11-02');
  assert.equal(source.inventory_review_action, 'CLOSED_INTO_INVENTORY');

  const protectedItem = {
    _id: 'protected-1',
    item_name: 'Milk',
    current_quantity: 4,
    beginning_quantity: 6,
    max_quantity: 10,
    lifecycle_status: 'ACTIVE',
    record_status: 'DRAFT',
    lineage_id: 'protected-lineage',
    source_form_id: '507f1f77bcf86cd799439013',
    actions: [{ action: 'CREATED', actor_type: 'VENDOR' }],
  };
  const employeeDraft = {
    _id: 'employee-draft-1',
    form_type: 'INVENTORY',
    status: 'DRAFT',
    inventory_items: makeItems([protectedItem]),
    async save() { this.saved = true; },
  };
  service.getScope = async () => ({
    vendor_user_id: '507f1f77bcf86cd799439011',
    food_truck_id: '507f1f77bcf86cd799439014',
    employee_internal_id: 'employee-1',
    employee_session_id: 'session-1',
    truck_unit_id: 'truck-1',
    location_id: 'location-1',
    truck_unit_label: 'Truck One',
    location_label: '1 Main Street',
  });
  service.getScopedForm = async () => employeeDraft;
  await service.update({
    user: {
      _id: '507f1f77bcf86cd799439015',
      userType: 'EMPLOYEE',
      first_name: 'Employee',
      last_name: 'One',
    },
    id: employeeDraft._id,
    payload: {
      inventory_items: [{
        _id: protectedItem._id,
        item_name: 'Milk corrected',
        current_quantity: 3,
        max_quantity: 10,
        lifecycle_status: 'ARCHIVED',
        source_form_id: '507f1f77bcf86cd799439099',
        employee_modified: true,
        actions: [{ action: 'ITEM_ARCHIVED', actor_type: 'EMPLOYEE' }],
      }],
    },
    notify: false,
  });
  const sanitized = employeeDraft.inventory_items[0];
  assert.equal(sanitized.item_name, 'Milk corrected');
  assert.equal(sanitized.current_quantity, 3);
  assert.equal(sanitized.lifecycle_status, 'ACTIVE', 'clients cannot forge lifecycle state');
  assert.equal(String(sanitized.source_form_id), '507f1f77bcf86cd799439013');
  assert.equal(sanitized.actions.length, 1, 'clients cannot forge inventory audit actions');
  assert.ok(sanitized.employee_modified_at, 'performing an employee count must mark the item as touched');

  const existingSeededItem = {
    _id: 'employee-item-1',
      source_item_id: 'vendor-item-1',
      item_name: 'Milk',
      current_quantity: 3,
      reorder_quantity: 7,
      notes: 'Employee count',
      employee_modified_at: new Date('2026-09-14T12:00:00.000Z'),
      employee_modified_by_id: '507f1f77bcf86cd799439015',
  };
  const employeeInventoryDraft = {
    inventory_items: makeItems([existingSeededItem]),
    async save() { this.saved = true; },
  };
  service.getEmployeeInventorySeed = async () => [
    {
      source_item_id: 'vendor-item-1',
      item_name: 'Whole Milk',
      current_quantity: 5,
      reorder_quantity: 5,
      record_status: 'SUBMITTED',
      notes: 'Vendor note',
    },
    {
      source_item_id: 'vendor-item-2',
      item_name: 'Cheese',
      current_quantity: 4,
      reorder_quantity: 1,
      record_status: 'SUBMITTED',
      notes: '',
    },
  ];
  await service.syncEmployeeInventoryDraft(employeeInventoryDraft, {});
  assert.equal(employeeInventoryDraft.inventory_items.length, 2, 'new active vendor inventory must sync into an open employee draft');
  assert.equal(employeeInventoryDraft.inventory_items[0].item_name, 'Whole Milk', 'vendor inventory details must refresh in an open employee draft');
  assert.equal(employeeInventoryDraft.inventory_items[0].current_quantity, 3, 'an in-progress employee count must be preserved');
  assert.equal(employeeInventoryDraft.inventory_items[0].notes, 'Employee count');
  assert.ok(employeeInventoryDraft.inventory_items[0].employee_modified_at, 'employee touch audit must survive draft synchronization');
  assert.equal(employeeInventoryDraft.inventory_items[1].item_name, 'Cheese');
  service.getEmployeeInventorySeed = originalSeedGetter;

  const discardableDraft = {
    _id: 'employee-draft-2',
    form_type: 'INVENTORY',
    status: 'DRAFT',
    employee_internal_id: 'employee-1',
    async save() { this.saved = true; },
  };
  service.getScopedForm = async () => discardableDraft;
  const discarded = await service.discardEmployeeInventoryDraft({
    user,
    id: discardableDraft._id,
  });
  assert.equal(discarded.form.status, 'CANCELLED');
  assert.equal(discarded.form.saved, true);
  assert.equal(String(discarded.form.archived_by_id), user._id);
  assert.ok(discarded.form.archived_at);

  service.getVendorInventoryItem = originalGetter;
  service.getScopedForm = originalScopedGetter;
  service.getVendorInventoryForm = originalVendorFormGetter;
  service.getScope = originalScopeGetter;
  service.getEmployeeInventorySeed = originalSeedGetter;
  OperationalComplianceFormModel.findOneAndUpdate = originalFindOneAndUpdate;
  OperationalComplianceFormModel.updateOne = originalUpdateOne;
  console.log('operational inventory action tests passed');
})().catch((error) => {
  service.getVendorInventoryItem = originalGetter;
  service.getScopedForm = originalScopedGetter;
  service.getVendorInventoryForm = originalVendorFormGetter;
  service.getScope = originalScopeGetter;
  service.getEmployeeInventorySeed = originalSeedGetter;
  OperationalComplianceFormModel.findOneAndUpdate = originalFindOneAndUpdate;
  OperationalComplianceFormModel.updateOne = originalUpdateOne;
  console.error(error);
  process.exitCode = 1;
});
