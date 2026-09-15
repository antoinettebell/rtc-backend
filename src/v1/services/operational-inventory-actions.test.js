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
    payload: { current_quantity: 2, use_by_date: '2026-10-01T12:00:00.000Z', close_count_draft: true },
  });
  assert.equal(active.current_quantity, 3, 'saving a close draft must not change active inventory');
  assert.equal(draft.item.pending_close_draft.current_quantity, 2);

  const result = await service.closeInventoryCount({
    user,
    id: 'form-1',
    itemId: active._id,
    payload: draft.item.pending_close_draft,
  });
  assert.equal(result.archived.lifecycle_status, 'ARCHIVED');
  assert.equal(result.archived.archive_reason, 'COUNT_CLOSED');
  assert.equal(result.next.lifecycle_status, 'ACTIVE');
  assert.equal(result.next.beginning_quantity, 2);
  assert.equal(result.next.current_quantity, 2);
  assert.equal(new Date(result.next.use_by_date).toISOString().slice(0, 10), '2026-10-01');
  assert.equal(form.saved, true);

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

  const existingSeededItem = {
    _id: 'employee-item-1',
    source_item_id: 'vendor-item-1',
    item_name: 'Milk',
    current_quantity: 3,
    reorder_quantity: 7,
    notes: 'Employee count',
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
      notes: 'Vendor note',
    },
    {
      source_item_id: 'vendor-item-2',
      item_name: 'Cheese',
      current_quantity: 4,
      reorder_quantity: 1,
      notes: '',
    },
  ];
  await service.syncEmployeeInventoryDraft(employeeInventoryDraft, {});
  assert.equal(employeeInventoryDraft.inventory_items.length, 2, 'new active vendor inventory must sync into an open employee draft');
  assert.equal(employeeInventoryDraft.inventory_items[0].item_name, 'Whole Milk', 'vendor inventory details must refresh in an open employee draft');
  assert.equal(employeeInventoryDraft.inventory_items[0].current_quantity, 3, 'an in-progress employee count must be preserved');
  assert.equal(employeeInventoryDraft.inventory_items[0].notes, 'Employee count');
  assert.equal(employeeInventoryDraft.inventory_items[1].item_name, 'Cheese');
  service.getEmployeeInventorySeed = originalSeedGetter;

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
