const {
  FoodTruckModel,
  OperationalComplianceFormModel: Model,
} = require('../../models');
const {
  buildChecklistItems,
  buildNextInventoryItems,
  normalizeInventoryItems,
} = require('../../helper/operational-compliance-form');
const CustomNotification = require('../../helper/custom-notification');
const {
  buildActorAuditIdentity,
  buildEmployeeFormIdentity,
  buildFreshChecklistDraft,
  buildVendorChecklistIdentity,
  isEmployeeFormAssignmentMatch,
  getEmployeeEditablePayload,
} = require('../../helper/operational-compliance-lifecycle');
const {
  buildOperationalNotification,
  runNonFatalNotificationEffect,
} = require('../../helper/operational-notification');
const {
  assertAssignedEmployeeLocationOpen,
  EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE,
} = require('../../helper/employee-operational-access');

const FORM_TYPES = ['INVENTORY', 'OPENING_CHECKLIST', 'CLOSING_CHECKLIST'];
const editableFields = [
  'truck_unit_id',
  'truck_unit',
  'form_date',
  'inventory_items',
  'checklist_items',
];

const errorWithCode = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const actorType = (user) =>
  user.userType === 'EMPLOYEE' || user.role === 'EMPLOYEE'
    ? 'EMPLOYEE'
    : 'VENDOR';

const preparedByName = (user) => buildActorAuditIdentity(user).prepared_by_name;

const inventoryEditableFields = [
  'item_location',
  'brand',
  'item_name',
  'purchased_from',
  'date_purchased',
  'use_by_date',
  'beginning_quantity',
  'current_quantity',
  'max_quantity',
  'notes',
];

const inventoryPayload = (payload = {}) => inventoryEditableFields.reduce(
  (result, field) => payload[field] === undefined
    ? result
    : { ...result, [field]: payload[field] },
  {}
);

const inventoryReorderQuantity = (item = {}) => item.reorder_resolved_at
  ? 0
  : Math.max(0, Number(item.max_quantity || 0) - Number(item.current_quantity || 0));

const assertInventoryQuantityBounds = (item = {}) => {
  if (Number(item.beginning_quantity || 0) > Number(item.max_quantity || 0)) {
    throw errorWithCode('Beginning quantity cannot exceed max quantity.', 422);
  }
};

const assertReceivedInventoryLot = (item = {}) => {
  const purchased = item.date_purchased ? new Date(item.date_purchased) : null;
  const useBy = item.use_by_date ? new Date(item.use_by_date) : null;
  if (!purchased || Number.isNaN(purchased.getTime()) || !useBy || Number.isNaN(useBy.getTime())) {
    throw errorWithCode('Enter the new item purchase and use-by dates.', 422);
  }
  if (
    Number(item.beginning_quantity) <= 0 ||
    Number(item.current_quantity) <= 0 ||
    Number(item.max_quantity) <= 0 ||
    Number(item.beginning_quantity) !== Number(item.current_quantity) ||
    Number(item.current_quantity) !== Number(item.max_quantity)
  ) {
    throw errorWithCode('Beginning, current, and max quantities must match the received quantity.', 422);
  }
};

const inventorySystemFields = [
  '_id',
  'lifecycle_status',
  'record_status',
  'lineage_id',
  'source_form_id',
  'source_item_id',
  'source_employee_internal_id',
  'employee_modified_at',
  'employee_modified_by_id',
  'archived_at',
  'archived_by_id',
  'archive_reason',
  'expiration_notification_key',
  'reorder_resolved_at',
  'pending_close_draft',
  'pending_close_saved_at',
  'pending_close_saved_by_id',
  'actions',
  'applied_review_keys',
];

const sanitizeEditableInventoryItems = (existingItems = [], incomingItems = [], employeeUser = null) => {
  const existingById = new Map((existingItems || []).map((item) => [String(item._id), item]));
  return normalizeInventoryItems((incomingItems || []).map((incoming) => {
    const existing = incoming?._id ? existingById.get(String(incoming._id)) : null;
    const preserved = existing
      ? inventorySystemFields.reduce((result, field) => (
          existing[field] === undefined ? result : { ...result, [field]: existing[field] }
        ), {})
      : {};
    const sanitized = { ...preserved, ...inventoryPayload(incoming) };
    if (employeeUser && incoming.employee_modified === true) {
      sanitized.employee_modified_at = new Date();
      sanitized.employee_modified_by_id = employeeUser._id;
    }
    return sanitized;
  }));
};

class OperationalComplianceFormService {
  async getScope(user) {
    if (actorType(user) === 'EMPLOYEE') {
      const foodTruck = await FoodTruckModel.findById(user.food_truck_id)
        .select('truck_units locations')
        .lean();
      const truckUnit = (foodTruck?.truck_units || []).find(
        (unit) => String(unit._id) === String(user.assigned_truck_unit_id)
      );
      const location = (foodTruck?.locations || []).find(
        (item) => String(item._id) === String(user.assigned_location_id)
      );
      return {
        vendor_user_id: user.vendor_user_id,
        food_truck_id: user.food_truck_id,
        employee_internal_id: user.employee_internal_id,
        employee_session_id: user.employee_session_id,
        truck_unit_id: user.assigned_truck_unit_id
          ? String(user.assigned_truck_unit_id)
          : null,
        location_id: user.assigned_location_id
          ? String(user.assigned_location_id)
          : null,
        truck_unit_label:
          truckUnit?.name || `Truck ${String(user.assigned_truck_unit_id || '')}`,
        location_label:
          location?.address || location?.name || `Location ${String(user.assigned_location_id || '')}`,
      };
    }

    const foodTruck = await FoodTruckModel.findOne({ userId: user._id })
      .select('_id userId')
      .lean();
    if (!foodTruck) {
      throw errorWithCode('Vendor food truck not found.', 404);
    }
    return { vendor_user_id: user._id, food_truck_id: foodTruck._id };
  }

  async getTruckUnits(user) {
    const scope = await this.getScope(user);
    const foodTruck = await FoodTruckModel.findById(scope.food_truck_id)
      .select('truck_units')
      .lean();
    return (foodTruck?.truck_units || [])
      .filter((unit) => !unit.is_archived)
      .map((unit) => ({ _id: unit._id, name: unit.name }));
  }

  validateType(type) {
    if (!FORM_TYPES.includes(type)) {
      throw errorWithCode('Invalid operational compliance form type.');
    }
  }

  async getEmployeeInventorySeed(scope) {
    const forms = await Model.find({
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
      form_type: 'INVENTORY',
      status: { $ne: 'ARCHIVED' },
      employee_internal_id: null,
      employee_session_id: null,
      $or: [
        { truck_unit_id: scope.truck_unit_id },
        { truck_unit_id: null, truck_unit: scope.truck_unit_label },
      ],
    }).sort({ updatedAt: -1 }).lean();
    const seen = new Set();
    const seeded = [];
    forms.forEach((form) => {
      (form.inventory_items || []).forEach((item) => {
        if ((item.lifecycle_status || 'ACTIVE') !== 'ACTIVE') return;
        if (item.record_status !== 'SUBMITTED') return;
        const lineage = String(item.lineage_id || item._id);
        if (seen.has(lineage)) return;
        seen.add(lineage);
        seeded.push({
          ...inventoryPayload(item),
          reorder_quantity: item.reorder_quantity,
          reorder_resolved_at: item.reorder_resolved_at,
          lifecycle_status: 'ACTIVE',
          record_status: 'DRAFT',
          lineage_id: lineage,
          source_form_id: form._id,
          source_item_id: String(item._id),
        });
      });
    });
    return seeded;
  }

  async syncEmployeeInventoryDraft(form, scope) {
    const seededItems = await this.getEmployeeInventorySeed(scope);
    const existingItems = form.inventory_items || [];
    const existingBySource = new Map(
      existingItems
        .filter((item) => item.source_item_id)
        .map((item) => [String(item.source_item_id), item])
    );
    const customItems = existingItems.filter((item) => !item.source_item_id);
    const mergedItems = seededItems.map((seed) => {
      const existing = existingBySource.get(String(seed.source_item_id));
      if (!existing) return seed;
      return {
        ...seed,
        current_quantity: existing.current_quantity,
        reorder_quantity: existing.reorder_quantity,
        notes: existing.notes,
        employee_modified_at: existing.employee_modified_at,
        employee_modified_by_id: existing.employee_modified_by_id,
      };
    });
    form.inventory_items = [...mergedItems, ...customItems];
    return form;
  }

  async list({ user, type, status }) {
    const scope = await this.getScope(user);
    const query = {
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
    };
    if (actorType(user) === 'EMPLOYEE') {
      query.status = { $nin: ['ARCHIVED', 'CANCELLED'] };
      if (type === 'INVENTORY') {
        query.employee_internal_id = scope.employee_internal_id;
        query.truck_unit_id = scope.truck_unit_id;
        query.location_id = scope.location_id;
      } else if (type) {
        query.employee_internal_id = scope.employee_internal_id;
      } else {
        query.$or = [
          { form_type: 'INVENTORY', employee_internal_id: scope.employee_internal_id, truck_unit_id: scope.truck_unit_id, location_id: scope.location_id },
          { form_type: { $ne: 'INVENTORY' }, employee_internal_id: scope.employee_internal_id },
        ];
      }
    }
    if (type) {
      this.validateType(type);
      query.form_type = type;
    }
    if (status) {
      if (actorType(user) === 'EMPLOYEE' && status === 'ARCHIVED') {
        throw errorWithCode('Employees cannot view archived operations forms.', 403);
      }
      query.status = status;
    }
    return Model.find(query).sort({ form_date: -1, createdAt: -1 }).lean();
  }

  async getOrCreateDraft({ user, type }) {
    this.validateType(type);
    const scope = await this.getScope(user);
    await this.assertEmployeeFormAccess({ user, type, scope });
    const identityScope = actorType(user) === 'EMPLOYEE'
      ? buildEmployeeFormIdentity({ scope, type })
      : type === 'INVENTORY'
        ? buildVendorChecklistIdentity()
        : buildVendorChecklistIdentity();
    const existing = await Model.findOne({
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
      ...identityScope,
      form_type: type,
      status: 'DRAFT',
    }).sort({ createdAt: -1 });
    if (existing) {
      if (type !== 'INVENTORY') {
        const auditIdentity = buildActorAuditIdentity(user);
        existing.prepared_by_name = auditIdentity.prepared_by_name;
        existing.initials = auditIdentity.initials;
      }
      if (actorType(user) === 'EMPLOYEE') {
        existing.employee_internal_id = scope.employee_internal_id;
        if (type !== 'INVENTORY') {
          existing.employee_session_id = scope.employee_session_id;
        }
        existing.truck_unit_id = scope.truck_unit_id;
        existing.location_id = scope.location_id;
        existing.truck_unit = scope.truck_unit_label;
        existing.location_label = scope.location_label;
        if (type === 'INVENTORY') {
          await this.syncEmployeeInventoryDraft(existing, scope);
        }
      } else if (type !== 'INVENTORY') {
        existing.employee_internal_id = null;
        existing.employee_session_id = null;
      }
      await existing.save();
      return existing;
    }
    if (actorType(user) === 'EMPLOYEE') {
      const submittedForShift = await Model.findOne({
        vendor_user_id: scope.vendor_user_id,
        food_truck_id: scope.food_truck_id,
        ...identityScope,
        form_type: type,
        status: 'SUBMITTED',
        ...(type === 'INVENTORY' ? { inventory_review_action: null } : {}),
      }).sort({ submitted_at: -1 });
      if (submittedForShift) {
        submittedForShift.truck_unit = scope.truck_unit_label;
        submittedForShift.location_label = scope.location_label;
        await submittedForShift.save();
        return submittedForShift;
      }
      if (type === 'INVENTORY') {
        await Model.updateMany(
          {
            vendor_user_id: scope.vendor_user_id,
            food_truck_id: scope.food_truck_id,
            ...identityScope,
            form_type: type,
            status: 'SUBMITTED',
            inventory_review_action: { $ne: null },
          },
          { $set: { status: 'ARCHIVED', archived_at: new Date() } }
        );
      }
    }

    const employeeInventorySeed = actorType(user) === 'EMPLOYEE' && type === 'INVENTORY'
      ? await this.getEmployeeInventorySeed(scope)
      : [];
    const draftPayload = actorType(user) === 'EMPLOYEE' && type !== 'INVENTORY'
      ? buildFreshChecklistDraft({
        scope,
        type,
        employeeName: preparedByName(user),
        employeeInitials: buildActorAuditIdentity(user).initials,
        checklistItems: buildChecklistItems(type),
      })
      : {
          vendor_user_id: scope.vendor_user_id,
          food_truck_id: scope.food_truck_id,
          ...identityScope,
          form_type: type,
          prepared_by_name: preparedByName(user),
          initials: buildActorAuditIdentity(user).initials,
          checklist_items: buildChecklistItems(type),
          inventory_items: employeeInventorySeed,
          ...(actorType(user) === 'EMPLOYEE'
            ? {
                truck_unit: scope.truck_unit_label,
                location_label: scope.location_label,
              }
            : {}),
        };
    try {
      return await Model.create(draftPayload);
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const racedDraft = await Model.findOne({
        vendor_user_id: scope.vendor_user_id,
        food_truck_id: scope.food_truck_id,
        ...identityScope,
        form_type: type,
        status: 'DRAFT',
      });
      if (racedDraft) return racedDraft;
      throw errorWithCode('Unable to create a new checklist for this shift.', 409);
    }
  }

  async getScopedForm({ user, id, enforceOperationalAccess = false }) {
    const scope = await this.getScope(user);
    const query = {
      _id: id,
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
    };
    if (actorType(user) === 'EMPLOYEE') {
      query.status = { $nin: ['ARCHIVED', 'CANCELLED'] };
    }
    const form = await Model.findOne(query);
    if (!form) throw errorWithCode('Operational compliance form not found.', 404);
    if (
      actorType(user) === 'EMPLOYEE' &&
      form.form_type !== 'INVENTORY' &&
      form.employee_internal_id !== scope.employee_internal_id
    ) {
      throw errorWithCode('Operational compliance form not found.', 404);
    }
    if (
      actorType(user) === 'EMPLOYEE' &&
      form.form_type === 'INVENTORY' &&
      (form.employee_internal_id !== scope.employee_internal_id ||
        String(form.truck_unit_id || '') !== scope.truck_unit_id ||
        String(form.location_id || '') !== scope.location_id)
    ) {
      throw errorWithCode('Operational compliance form not found.', 404);
    }
    if (enforceOperationalAccess) {
      await this.assertEmployeeFormAccess({ user, type: form.form_type, scope, form });
    }
    return form;
  }

  async assertEmployeeFormAccess({ user, type, scope, form = null }) {
    if (actorType(user) !== 'EMPLOYEE') return;
    if (!scope.employee_session_id) {
      throw errorWithCode('An active employee shift is required.', 403);
    }
    if (!scope.truck_unit_id || !scope.location_id) {
      throw errorWithCode('Your assigned truck and location are required.', 403);
    }
    if (form) {
      if (!isEmployeeFormAssignmentMatch({ form, scope })) {
        throw errorWithCode('This form belongs to another truck or location.', 403);
      }
    }
    if (type === 'OPENING_CHECKLIST') return;
    const foodTruck = await FoodTruckModel.findById(scope.food_truck_id)
      .select('truck_units')
      .lean();
    try {
      assertAssignedEmployeeLocationOpen({
        foodTruck,
        assignedTruckUnitId: scope.truck_unit_id,
        assignedLocationId: scope.location_id,
      });
    } catch (error) {
      throw errorWithCode(EMPLOYEE_ASSIGNED_LOCATION_CLOSED_MESSAGE, 403);
    }
  }

  async update({ user, id, payload, notify = true }) {
    const employeeScope = actorType(user) === 'EMPLOYEE'
      ? await this.getScope(user)
      : null;
    const form = await this.getScopedForm({
      user,
      id,
      enforceOperationalAccess: true,
    });
    if (
      actorType(user) === 'VENDOR' &&
      form.form_type === 'INVENTORY' &&
      form.employee_internal_id
    ) {
      throw errorWithCode('Employee inventory submissions are immutable. Use Employee Inventory Review.', 409);
    }
    if (form.status !== 'DRAFT') {
      throw errorWithCode('Click the pencil to edit this submitted form.', 409);
    }

    const editablePayload = employeeScope
      ? getEmployeeEditablePayload(payload)
      : payload;
    editableFields.filter((field) => field !== 'inventory_items').forEach((field) => {
      if (editablePayload[field] !== undefined) {
        form[field] = editablePayload[field];
      }
    });
    if (form.form_type === 'INVENTORY') {
      form.inventory_items = editablePayload.inventory_items === undefined
        ? normalizeInventoryItems(form.inventory_items)
        : sanitizeEditableInventoryItems(form.inventory_items, editablePayload.inventory_items, employeeScope ? user : null);
      form.inventory_items.forEach(assertInventoryQuantityBounds);
    }
    form.last_edited_at = new Date();
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = actorType(user);
    const auditIdentity = buildActorAuditIdentity(user);
    form.prepared_by_name = auditIdentity.prepared_by_name;
    form.initials = auditIdentity.initials;
    if (employeeScope) {
      form.employee_internal_id = employeeScope.employee_internal_id;
      form.employee_session_id = employeeScope.employee_session_id;
      form.truck_unit_id = employeeScope.truck_unit_id;
      form.location_id = employeeScope.location_id;
      form.vendor_user_id = employeeScope.vendor_user_id;
      form.food_truck_id = employeeScope.food_truck_id;
      form.truck_unit = employeeScope.truck_unit_label;
      form.location_label = employeeScope.location_label;
    }
    await form.save();
    if (
      notify &&
      actorType(user) === 'EMPLOYEE' &&
      form.form_type === 'INVENTORY'
    ) {
      await this.notifyVendor({ form, user, action: 'SAVED' });
    }
    return form;
  }

  async submit({ user, id, payload = {} }) {
    let form = await this.getScopedForm({
      user,
      id,
      enforceOperationalAccess: true,
    });
    if (form.status !== 'DRAFT') {
      throw errorWithCode('Only a draft form can be submitted.', 409);
    }
    if (Object.keys(payload).length) {
      form = await this.update({ user, id, payload, notify: false });
    }
    if (form.form_type === 'INVENTORY' && !form.inventory_items.length) {
      throw errorWithCode('Add at least one inventory item before submitting.');
    }
    if (
      form.form_type === 'INVENTORY' &&
      actorType(user) === 'EMPLOYEE' &&
      !form.inventory_items.some((item) => item.employee_modified_at)
    ) {
      throw errorWithCode('Perform a count or add an inventory item before submitting.', 422);
    }
    if (
      form.form_type !== 'INVENTORY' &&
      form.checklist_items.some((item) => !item.completed)
    ) {
      throw errorWithCode('Complete every checklist item before submitting.');
    }
    form.status = 'SUBMITTED';
    form.submitted_at = new Date();
    form.submitted_by_id = user._id;
    form.submitted_by_type = actorType(user);
    await form.save();
    if (actorType(user) === 'EMPLOYEE') {
      await this.notifyVendor({ form, user, action: 'SUBMITTED' });
    }
    return form;
  }

  async unlock({ user, id }) {
    if (actorType(user) !== 'VENDOR') {
      throw errorWithCode('Only the vendor can unlock a submitted form.', 403);
    }
    const form = await this.getScopedForm({ user, id });
    if (form.form_type === 'INVENTORY' && form.employee_internal_id) {
      throw errorWithCode('Employee inventory submissions are immutable. Use Employee Inventory Review.', 409);
    }
    if (form.status === 'ARCHIVED') {
      throw errorWithCode('Archived forms are permanent read-only records.', 409);
    }
    if (form.status === 'SUBMITTED') {
      form.status = 'DRAFT';
      form.last_edited_at = new Date();
      form.last_edited_by_id = user._id;
      form.last_edited_by_type = actorType(user);
      await form.save();
    }
    return form;
  }

  async archive({ user, id }) {
    if (actorType(user) !== 'VENDOR') {
      throw errorWithCode('Only the vendor can archive a submitted form.', 403);
    }
    const form = await this.getScopedForm({ user, id });
    if (form.form_type === 'INVENTORY' && form.employee_internal_id) {
      throw errorWithCode('Use Employee Inventory Review to archive an employee submission.', 409);
    }
    if (form.status !== 'SUBMITTED') {
      throw errorWithCode('Submit the form before archiving it.', 409);
    }

    let next = await Model.findOne({ source_archive_id: form._id });
    if (!next) {
      next = await Model.create({
        vendor_user_id: form.vendor_user_id,
        food_truck_id: form.food_truck_id,
        employee_internal_id:
          form.form_type === 'INVENTORY' ? null : form.employee_internal_id,
        employee_session_id:
          form.form_type === 'INVENTORY' ? null : form.employee_session_id,
        truck_unit_id: form.truck_unit_id,
        location_id: form.location_id,
        form_type: form.form_type,
        status: 'DRAFT',
        source_archive_id: form._id,
        prepared_by_name: buildActorAuditIdentity(user).prepared_by_name,
        initials: buildActorAuditIdentity(user).initials,
        truck_unit: form.truck_unit,
        location_label: form.location_label,
        inventory_items:
          form.form_type === 'INVENTORY'
            ? buildNextInventoryItems(form.inventory_items)
            : [],
        checklist_items: buildChecklistItems(form.form_type),
      });
    }
    form.status = 'ARCHIVED';
    form.archived_at = new Date();
    form.archived_by_id = user._id;
    await form.save();
    return { archived: form, next };
  }

  assertVendor(user) {
    if (actorType(user) !== 'VENDOR') {
      throw errorWithCode('Only the vendor can manage final inventory.', 403);
    }
  }

  inventoryAction(user, action, now = new Date()) {
    return {
      action,
      actor_id: user._id,
      actor_type: actorType(user),
      actor_name: preparedByName(user),
      occurred_at: now,
    };
  }

  async getVendorInventoryForm({ user, truckUnitId, truckUnit }) {
    this.assertVendor(user);
    const scope = await this.getScope(user);
    const unit = (await this.getTruckUnits(user)).find(
      (item) => String(item._id) === String(truckUnitId || '') || item.name === truckUnit
    );
    if (!unit) throw errorWithCode('Choose an active truck unit.', 422);
    let form = await Model.findOne({
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
      form_type: 'INVENTORY',
      status: 'DRAFT',
      employee_internal_id: null,
      employee_session_id: null,
      $or: [
        { truck_unit_id: String(unit._id) },
        { truck_unit_id: null, truck_unit: unit.name },
      ],
    }).sort({ createdAt: -1 });
    if (!form) {
      form = await Model.create({
        vendor_user_id: scope.vendor_user_id,
        food_truck_id: scope.food_truck_id,
        employee_internal_id: null,
        employee_session_id: null,
        truck_unit_id: String(unit._id),
        form_type: 'INVENTORY',
        status: 'DRAFT',
        prepared_by_name: preparedByName(user),
        initials: buildActorAuditIdentity(user).initials,
        truck_unit: unit.name,
      });
    } else if (!form.truck_unit_id) {
      form.truck_unit_id = String(unit._id);
    }
    return form;
  }

  async getVendorInventoryItem({ user, id, itemId }) {
    this.assertVendor(user);
    const form = await this.getScopedForm({ user, id });
    if (
      form.form_type !== 'INVENTORY' ||
      form.employee_internal_id ||
      form.employee_session_id
    ) {
      throw errorWithCode('Vendor inventory item not found.', 404);
    }
    const item = form.inventory_items.id(itemId);
    if (!item) throw errorWithCode('Inventory item not found.', 404);
    return { form, item };
  }

  async createInventoryItem({ user, payload = {} }) {
    const form = await this.getVendorInventoryForm({
      user,
      truckUnitId: payload.truck_unit_id,
      truckUnit: payload.truck_unit,
    });
    const now = new Date();
    const normalized = normalizeInventoryItems([inventoryPayload(payload.item || payload)])[0];
    if (!String(normalized.item_name || '').trim()) {
      throw errorWithCode('Inventory item name is required.', 422);
    }
    assertInventoryQuantityBounds(normalized);
    const item = form.inventory_items.create({
      ...normalized,
      lifecycle_status: 'ACTIVE',
      record_status: 'DRAFT',
      actions: [this.inventoryAction(user, 'CREATED', now)],
    });
    item.lineage_id = String(item._id);
    form.inventory_items.push(item);
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    return { form, item: form.inventory_items.id(item._id) };
  }

  async updateInventoryItem({ user, id, itemId, payload = {}, submit = false }) {
    const { form, item } = await this.getVendorInventoryItem({ user, id, itemId });
    if ((item.lifecycle_status || 'ACTIVE') !== 'ACTIVE') {
      throw errorWithCode('Archived inventory is read-only.', 409);
    }
    const now = new Date();
    const normalized = normalizeInventoryItems([{ ...item.toObject(), ...inventoryPayload(payload.item || payload) }])[0];
    if (!String(normalized.item_name || '').trim()) {
      throw errorWithCode('Inventory item name is required.', 422);
    }
    if (payload.close_count_draft) {
      item.pending_close_draft = inventoryPayload(payload.item || payload);
      item.pending_close_saved_at = now;
      item.pending_close_saved_by_id = user._id;
      item.actions.push(this.inventoryAction(user, 'SAVED_DRAFT', now));
      form.last_edited_at = now;
      form.last_edited_by_id = user._id;
      form.last_edited_by_type = 'VENDOR';
      await form.save();
      return { form, item };
    }
    assertInventoryQuantityBounds(normalized);
    inventoryEditableFields.forEach((field) => { item[field] = normalized[field]; });
    item.reorder_quantity = normalized.reorder_quantity;
    item.record_status = submit ? 'SUBMITTED' : 'DRAFT';
    item.expiration_notification_key = null;
    item.actions.push(this.inventoryAction(user, submit ? 'SUBMITTED' : 'SAVED_DRAFT', now));
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    return { form, item };
  }

  async closeInventoryCount({ user, id, itemId, payload = {} }) {
    const { form, item } = await this.getVendorInventoryItem({ user, id, itemId });
    if ((item.lifecycle_status || 'ACTIVE') !== 'ACTIVE') {
      throw errorWithCode('This inventory count is already closed.', 409);
    }
    const reorderNeeded = inventoryReorderQuantity(item);
    if (reorderNeeded === 0) {
      throw errorWithCode('No reorder is currently needed for this inventory item.', 409);
    }
    const now = new Date();
    const replacementPayload = inventoryPayload(payload.item || payload);
    const edited = normalizeInventoryItems([{ ...item.toObject(), ...replacementPayload }])[0];
    assertInventoryQuantityBounds(edited);
    assertReceivedInventoryLot(edited);
    const replacement = form.inventory_items.create({
      ...inventoryPayload(edited),
      reorder_quantity: 0,
      reorder_resolved_at: null,
      lifecycle_status: 'ACTIVE',
      record_status: 'SUBMITTED',
      actions: [this.inventoryAction(user, 'REORDER_RECEIVED', now)],
    });
    replacement.lineage_id = String(replacement._id);
    item.reorder_quantity = 0;
    item.reorder_resolved_at = now;
    item.record_status = 'SUBMITTED';
    item.pending_close_draft = null;
    item.pending_close_saved_at = null;
    item.pending_close_saved_by_id = null;
    item.actions.push(this.inventoryAction(user, 'REORDER_RECEIVED', now));
    form.inventory_items.push(replacement);
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    return { form, current: item, next: form.inventory_items.id(replacement._id) };
  }

  async archiveInventoryItem({ user, id, itemId }) {
    const { form, item } = await this.getVendorInventoryItem({ user, id, itemId });
    if ((item.lifecycle_status || 'ACTIVE') !== 'ACTIVE') {
      throw errorWithCode('This inventory item is already archived.', 409);
    }
    const now = new Date();
    item.lifecycle_status = 'ARCHIVED';
    item.archived_at = now;
    item.archived_by_id = user._id;
    item.archive_reason = 'ITEM_ARCHIVED';
    item.actions.push(this.inventoryAction(user, 'ITEM_ARCHIVED', now));
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    return { form, item };
  }

  async discardEmployeeInventoryDraft({ user, id }) {
    this.assertVendor(user);
    const form = await this.getScopedForm({ user, id });
    if (
      form.form_type !== 'INVENTORY' ||
      form.status !== 'DRAFT' ||
      !form.employee_internal_id
    ) {
      throw errorWithCode('Employee inventory draft not found.', 404);
    }
    const now = new Date();
    form.status = 'CANCELLED';
    form.archived_at = now;
    form.archived_by_id = user._id;
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    return { form };
  }

  async reviewEmployeeInventory({ user, id, payload = {} }) {
    this.assertVendor(user);
    let source = await this.getScopedForm({ user, id });
    if (
      source.form_type !== 'INVENTORY' ||
      source.status !== 'SUBMITTED' ||
      !source.employee_internal_id
    ) {
      throw errorWithCode('Employee inventory submission not found.', 404);
    }
    if (source.inventory_review_action) {
      throw errorWithCode('This employee inventory submission was already reviewed.', 409);
    }
    const action = payload.action;
    if (!['UPDATED', 'CLOSED_INTO_INVENTORY', 'ARCHIVED'].includes(action)) {
      throw errorWithCode('Choose a valid inventory review action.', 422);
    }
    const claimTime = new Date();
    const staleClaimBefore = new Date(claimTime.getTime() - 5 * 60 * 1000);
    source = await Model.findOneAndUpdate(
      {
        _id: source._id,
        vendor_user_id: source.vendor_user_id,
        food_truck_id: source.food_truck_id,
        inventory_review_action: null,
        $or: [
          { inventory_review_claimed_at: null },
          { inventory_review_claimed_at: { $lt: staleClaimBefore } },
        ],
      },
      {
        $set: {
          inventory_review_claimed_at: claimTime,
          inventory_review_claim_action: action,
          inventory_review_claimed_by_id: user._id,
        },
      },
      { new: true }
    );
    if (!source) {
      throw errorWithCode('This employee inventory submission is already being reviewed.', 409);
    }
    let reviewCompleted = false;
    try {
    const linkedSourceFormId = (source.inventory_items || []).find((item) => item.source_form_id)?.source_form_id;
    let form = linkedSourceFormId
      ? await Model.findOne({
          _id: linkedSourceFormId,
          vendor_user_id: source.vendor_user_id,
          food_truck_id: source.food_truck_id,
          form_type: 'INVENTORY',
          status: { $ne: 'ARCHIVED' },
          employee_internal_id: null,
          employee_session_id: null,
        })
      : null;
    if (!form) {
      form = await this.getVendorInventoryForm({
        user,
        truckUnitId: source.truck_unit_id,
        truckUnit: source.truck_unit,
      });
    }
    const now = new Date();
    const submittedItems = (source.inventory_items || []).filter((item) => item.employee_modified_at);
    if (!submittedItems.length) {
      throw errorWithCode('No employee inventory changes were submitted.', 409);
    }
    const submittedById = new Map(submittedItems.map((item) => [String(item._id), item]));
    const reviewedItems = normalizeInventoryItems(payload.inventory_items || submittedItems).map((item) => {
      const submitted = submittedById.get(String(item._id));
      if (!submitted) return item;
      return {
        ...item,
        lineage_id: submitted.lineage_id || item.lineage_id,
        source_form_id: submitted.source_form_id || item.source_form_id,
        source_item_id: submitted.source_item_id || item.source_item_id,
      };
    });
    const replacementItems = normalizeInventoryItems(payload.reorder_items || []);
    const replacementBySubmittedId = new Map(
      replacementItems.map((item) => [String(item._id), item])
    );
    const activeMatch = (sourceItem) => {
      const exact = form.inventory_items.find((candidate) => {
        if ((candidate.lifecycle_status || 'ACTIVE') !== 'ACTIVE') return false;
        if (sourceItem.lineage_id && String(candidate.lineage_id || candidate._id) === String(sourceItem.lineage_id)) {
          return true;
        }
        return sourceItem.source_item_id && String(candidate._id) === String(sourceItem.source_item_id);
      });
      if (exact) return exact;
      const normalizedName = String(sourceItem.item_name || '').trim().toLowerCase();
      if (!normalizedName) return null;
      const nameMatches = form.inventory_items.filter((candidate) => (
        (candidate.lifecycle_status || 'ACTIVE') === 'ACTIVE' &&
        String(candidate.item_name || '').trim().toLowerCase() === normalizedName
      ));
      return nameMatches.length === 1 ? nameMatches[0] : null;
    };
    if (action === 'CLOSED_INTO_INVENTORY') {
      const reorderItems = submittedItems.filter((item) => inventoryReorderQuantity(item) > 0);
      if (!reorderItems.length) {
        throw errorWithCode('No reorder is currently needed for this inventory submission.', 409);
      }
      reorderItems.forEach((sourceItem) => {
        const replacement = replacementBySubmittedId.get(String(sourceItem._id));
        if (!replacement) {
          throw errorWithCode(`Enter the new product details for ${sourceItem.item_name || 'each reordered item'}.`, 422);
        }
        assertInventoryQuantityBounds(replacement);
        assertReceivedInventoryLot(replacement);
      });
    }
    const itemsToReview = action === 'CLOSED_INTO_INVENTORY' ? submittedItems : reviewedItems;
    itemsToReview.forEach((sourceItem) => {
      const reviewKey = `${source._id}:${sourceItem._id}:${action}`;
      if (form.inventory_items.some((candidate) => (
        candidate.applied_review_keys || []
      ).includes(reviewKey))) return;
      const existing = activeMatch(sourceItem);
      if (action === 'CLOSED_INTO_INVENTORY') {
        const reorderNeeded = inventoryReorderQuantity(sourceItem) > 0;
        if (existing) {
          existing.current_quantity = sourceItem.current_quantity;
          existing.reorder_quantity = reorderNeeded
            ? 0
            : inventoryReorderQuantity(existing);
          existing.record_status = 'SUBMITTED';
          existing.applied_review_keys ||= [];
          existing.applied_review_keys.push(reviewKey);
          existing.actions.push(this.inventoryAction(
            user,
            reorderNeeded ? 'REORDER_RECEIVED' : 'ITEM_UPDATED',
            now
          ));
          if (reorderNeeded) existing.reorder_resolved_at = now;
        }
        if (!reorderNeeded) return;
        const replacement = replacementBySubmittedId.get(String(sourceItem._id));
        const copied = form.inventory_items.create({
          ...inventoryPayload(sourceItem),
          ...inventoryPayload(replacement),
          reorder_quantity: 0,
          lifecycle_status: 'ACTIVE',
          record_status: 'SUBMITTED',
          reorder_resolved_at: null,
          actions: [this.inventoryAction(user, 'REORDER_RECEIVED', now)],
          source_form_id: source._id,
          source_item_id: String(sourceItem._id || ''),
          source_employee_internal_id: source.employee_internal_id,
          applied_review_keys: [reviewKey],
        });
        copied.lineage_id = String(copied._id);
        form.inventory_items.push(copied);
        return;
      }
      if (existing && action === 'UPDATED') {
        const normalized = inventoryPayload(sourceItem);
        inventoryEditableFields.forEach((field) => { existing[field] = normalized[field]; });
        existing.reorder_quantity = Math.max(0, existing.max_quantity - existing.current_quantity);
        existing.record_status = 'SUBMITTED';
        existing.expiration_notification_key = null;
        existing.applied_review_keys ||= [];
        existing.applied_review_keys.push(reviewKey);
        existing.actions.push(this.inventoryAction(user, 'ITEM_UPDATED', now));
        return;
      }
      if (existing) {
        existing.lifecycle_status = 'ARCHIVED';
        existing.archived_at = now;
        existing.archived_by_id = user._id;
        existing.archive_reason = action === 'ARCHIVED' ? 'ITEM_ARCHIVED' : 'COUNT_CLOSED';
        existing.applied_review_keys ||= [];
        existing.applied_review_keys.push(reviewKey);
        existing.actions.push(this.inventoryAction(
          user,
          action === 'ARCHIVED' ? 'ITEM_ARCHIVED' : 'COUNT_CLOSED',
          now
        ));
      }
      if (action === 'ARCHIVED' && existing) return;
      const copied = form.inventory_items.create({
        ...inventoryPayload(sourceItem),
        lifecycle_status: action === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
        record_status: 'SUBMITTED',
        archived_at: action === 'ARCHIVED' ? now : null,
        archived_by_id: action === 'ARCHIVED' ? user._id : null,
        archive_reason: action === 'ARCHIVED' ? 'ITEM_ARCHIVED' : null,
        actions: [this.inventoryAction(
          user,
          action === 'ARCHIVED'
            ? 'ITEM_ARCHIVED'
            : action === 'UPDATED'
              ? 'ITEM_UPDATED'
              : 'COUNT_CLOSED',
          now
        )],
        source_form_id: source._id,
        source_item_id: String(sourceItem._id || ''),
        source_employee_internal_id: source.employee_internal_id,
        applied_review_keys: [reviewKey],
      });
      copied.lineage_id = sourceItem.lineage_id || String(copied._id);
      form.inventory_items.push(copied);
    });
    source.inventory_review_action = action;
    source.inventory_reviewed_at = now;
    source.inventory_reviewed_by_id = user._id;
    source.status = 'ARCHIVED';
    source.archived_at = now;
    source.archived_by_id = user._id;
    source.inventory_review_claimed_at = null;
    source.inventory_review_claim_action = null;
    source.inventory_review_claimed_by_id = null;
    form.last_edited_at = now;
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = 'VENDOR';
    await form.save();
    await source.save();
    reviewCompleted = true;
    return { source, form };
    } finally {
      if (!reviewCompleted) {
        await Model.updateOne(
          {
            _id: source._id,
            inventory_review_action: null,
            inventory_review_claimed_by_id: user._id,
          },
          {
            $set: {
              inventory_review_claimed_at: null,
              inventory_review_claim_action: null,
              inventory_review_claimed_by_id: null,
            },
          }
        ).catch(() => {});
      }
    }
  }

  async notifyVendor({ form, user, action, sendPush = true }) {
    const OperationalNotificationModel = require('../../models').OperationalNotificationModel;
    const occurredAt = action === 'SUBMITTED'
      ? form.submitted_at || new Date()
      : form.last_edited_at || new Date();
    const eventKey = form.notification_event_key ||
      `${form._id}:${action}:${new Date(occurredAt).getTime()}`;
    await runNonFatalNotificationEffect(async () => {
      await Model.updateOne(
        { _id: form._id },
        {
          $set: {
            notification_pending_action: action,
            notification_event_key: eventKey,
            notification_error: null,
          },
        }
      );
      await OperationalNotificationModel.findOneAndUpdate(
        { event_key: eventKey },
        {
          $setOnInsert: buildOperationalNotification({
            form,
            user,
            employeeName: preparedByName(user) || form.prepared_by_name || 'Employee',
            action,
            eventKey,
            now: occurredAt,
          }),
        },
        { upsert: true, new: true }
      );
      await Model.updateOne(
        { _id: form._id, notification_event_key: eventKey },
        {
          $set: {
            notification_pending_action: null,
            notification_event_key: null,
            notification_error: null,
          },
        }
      );
    }, async (error) => {
      await Model.updateOne(
        { _id: form._id, notification_event_key: eventKey },
        { $set: { notification_error: error.message } }
      ).catch(() => {});
      console.error('Persistent operations notification deferred for retry', {
        form_id: form._id,
        event_key: eventKey,
        message: error.message,
      });
    });
    if (sendPush) CustomNotification.sendNotificationToUsers({
      [form.vendor_user_id.toString()]: {
        title: action === 'SAVED' ? 'Inventory updated' : 'Operations form submitted',
        body: `${form.prepared_by_name || 'An employee'} ${action.toLowerCase()} ${form.form_type
          .toLowerCase()
          .replaceAll('_', ' ')}.`,
        data: {
          activityType: `OPERATIONAL_COMPLIANCE_${action}`,
          formId: form._id.toString(),
          formType: form.form_type,
        },
      },
    }).catch((error) => {
      console.error('Operations push notification failed', {
        formId: form._id,
        message: error.message,
      });
    });
  }

  async retryPendingNotificationsForVendor(vendorUserId) {
    const forms = await Model.find({
      vendor_user_id: vendorUserId,
      notification_pending_action: { $in: ['SAVED', 'SUBMITTED'] },
    }).limit(50);
    await Promise.all(forms.map((form) => this.notifyVendor({
      form,
      user: { employee_internal_id: form.employee_internal_id, userType: 'EMPLOYEE' },
      action: form.notification_pending_action,
      sendPush: false,
    })));
  }

  async processExpiredInventoryNotifications({ vendorUserId = null, now = new Date() } = {}) {
    const {
      OperationalNotificationModel,
    } = require('../../models');
    const { getOperationalDayKey } = require('../../helper/employee-operational-day-helper');
    const query = {
      form_type: 'INVENTORY',
      status: { $ne: 'ARCHIVED' },
      employee_internal_id: null,
      employee_session_id: null,
      inventory_items: {
        $elemMatch: {
          lifecycle_status: { $ne: 'ARCHIVED' },
          use_by_date: { $ne: null },
        },
      },
    };
    if (vendorUserId) query.vendor_user_id = vendorUserId;
    const timeZoneByTruck = new Map();
    let created = 0;
    const cursor = Model.find(query).cursor();
    for await (const form of cursor) {
      const foodTruckId = String(form.food_truck_id);
      if (!timeZoneByTruck.has(foodTruckId)) {
        const foodTruck = await FoodTruckModel.findById(form.food_truck_id)
          .select('schedule_time_zone')
          .lean();
        timeZoneByTruck.set(
          foodTruckId,
          foodTruck?.schedule_time_zone || 'America/New_York'
        );
      }
      const timeZone = timeZoneByTruck.get(foodTruckId);
      const operationalDay = getOperationalDayKey(now, timeZone);
      for (const item of form.inventory_items || []) {
        if (
          (item.lifecycle_status || 'ACTIVE') !== 'ACTIVE' ||
          item.record_status !== 'SUBMITTED' ||
          !item.use_by_date
        ) continue;
        const useByDay = new Date(item.use_by_date).toISOString().slice(0, 10);
        if (operationalDay < useByDay) continue;
        const eventKey = `inventory-expired:${form._id}:${item._id}:${useByDay}`;
        try {
          let notification;
          try {
            notification = await OperationalNotificationModel.create({
            vendor_user_id: form.vendor_user_id,
            employee_internal_id: null,
            employee_name: 'Inventory',
            form_id: form._id,
            form_type: 'INVENTORY',
            action: 'EXPIRED',
            event_key: eventKey,
            food_truck_id: form.food_truck_id,
            truck_unit_id: form.truck_unit_id,
            location_id: form.location_id,
            inventory_item_id: String(item._id),
            inventory_item_name: item.item_name,
            occurred_at: now,
            });
            created += 1;
          } catch (error) {
            if (error?.code !== 11000) throw error;
            notification = await OperationalNotificationModel.findOne({ event_key: eventKey });
          }
          if (!notification || notification.push_sent_at) continue;
          const retryBefore = new Date(now.getTime() - 5 * 60 * 1000);
          notification = await OperationalNotificationModel.findOneAndUpdate(
            {
              _id: notification._id,
              push_sent_at: null,
              $or: [
                { push_claimed_at: null },
                { push_claimed_at: { $lt: retryBefore } },
              ],
            },
            { $set: { push_claimed_at: now } },
            { new: true }
          );
          if (!notification) continue;
          try {
            await CustomNotification.sendNotificationToUsers({
            [form.vendor_user_id.toString()]: {
              title: `Inventory Item: ${item.item_name} has expired.`,
              body: 'Please update the expiration date or close the inventory count with a fresher item.',
              data: {
                activityType: 'INVENTORY_ITEM_EXPIRED',
                formId: String(form._id),
                formType: 'INVENTORY',
                inventoryItemId: String(item._id),
              },
            },
            });
            notification.push_sent_at = new Date();
            notification.push_claimed_at = null;
            notification.push_error = null;
            await notification.save();
          } catch (error) {
            notification.push_error = String(error?.message || 'Push notification failed').slice(0, 500);
            notification.push_claimed_at = null;
            await notification.save().catch(() => {});
            console.error('Inventory expiration push failed', {
              form_id: form._id,
              inventory_item_id: item._id,
              message: error.message,
            });
          }
        } catch (error) {
          throw error;
        }
      }
    }
    return created;
  }
}

module.exports = new OperationalComplianceFormService();
