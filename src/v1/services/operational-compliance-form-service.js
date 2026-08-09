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
  buildEmployeeFormIdentity,
  buildFreshChecklistDraft,
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
  'prepared_by_name',
  'initials',
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

const preparedByName = (user) => {
  if (actorType(user) === 'VENDOR') return 'Vendor';
  return [user.first_name, user.last_name].filter(Boolean).join(' ');
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

  async list({ user, type, status }) {
    const scope = await this.getScope(user);
    const query = {
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
    };
    if (actorType(user) === 'EMPLOYEE') {
      query.status = { $ne: 'ARCHIVED' };
      if (type === 'INVENTORY') {
        query.truck_unit_id = scope.truck_unit_id;
        query.location_id = scope.location_id;
      } else if (type) {
        query.employee_internal_id = scope.employee_internal_id;
      } else {
        query.$or = [
          { form_type: 'INVENTORY', truck_unit_id: scope.truck_unit_id, location_id: scope.location_id },
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
      : {};
    const existing = await Model.findOne({
      vendor_user_id: scope.vendor_user_id,
      food_truck_id: scope.food_truck_id,
      ...identityScope,
      form_type: type,
      status: 'DRAFT',
    }).sort({ createdAt: -1 });
    if (existing) {
      if (actorType(user) === 'EMPLOYEE') {
        existing.prepared_by_name = preparedByName(user);
        existing.employee_internal_id = scope.employee_internal_id;
        if (type !== 'INVENTORY') {
          existing.employee_session_id = scope.employee_session_id;
        }
        existing.truck_unit_id = scope.truck_unit_id;
        existing.location_id = scope.location_id;
        existing.truck_unit = scope.truck_unit_label;
        existing.location_label = scope.location_label;
        await existing.save();
      } else if (!String(existing.prepared_by_name || '').trim()) {
        existing.prepared_by_name = preparedByName(user);
        await existing.save();
      }
      return existing;
    }
    if (actorType(user) === 'EMPLOYEE' && type !== 'INVENTORY') {
      const submittedForShift = await Model.findOne({
        vendor_user_id: scope.vendor_user_id,
        food_truck_id: scope.food_truck_id,
        ...identityScope,
        form_type: type,
        status: 'SUBMITTED',
      }).sort({ submitted_at: -1 });
      if (submittedForShift) {
        submittedForShift.truck_unit = scope.truck_unit_label;
        submittedForShift.location_label = scope.location_label;
        await submittedForShift.save();
        return submittedForShift;
      }
    }

    const draftPayload = actorType(user) === 'EMPLOYEE' && type !== 'INVENTORY'
      ? buildFreshChecklistDraft({
        scope,
        type,
        employeeName: preparedByName(user),
        checklistItems: buildChecklistItems(type),
      })
      : {
          vendor_user_id: scope.vendor_user_id,
          food_truck_id: scope.food_truck_id,
          ...identityScope,
          form_type: type,
          prepared_by_name: preparedByName(user),
          checklist_items: buildChecklistItems(type),
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
      query.status = { $ne: 'ARCHIVED' };
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
      (String(form.truck_unit_id || '') !== scope.truck_unit_id ||
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
    if (form.status !== 'DRAFT') {
      throw errorWithCode('Click the pencil to edit this submitted form.', 409);
    }

    const editablePayload = employeeScope
      ? getEmployeeEditablePayload(payload)
      : payload;
    editableFields.forEach((field) => {
      if (editablePayload[field] !== undefined) {
        form[field] = editablePayload[field];
      }
    });
    if (form.form_type === 'INVENTORY') {
      form.inventory_items = normalizeInventoryItems(form.inventory_items);
    }
    form.last_edited_at = new Date();
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = actorType(user);
    if (employeeScope) {
      form.prepared_by_name = preparedByName(user);
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
    if (form.status !== 'SUBMITTED') {
      throw errorWithCode('Submit the form before archiving it.', 409);
    }

    form.status = 'ARCHIVED';
    form.archived_at = new Date();
    form.archived_by_id = user._id;
    await form.save();

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
        inventory_items:
          form.form_type === 'INVENTORY'
            ? buildNextInventoryItems(form.inventory_items)
            : [],
        checklist_items: buildChecklistItems(form.form_type),
      });
    }
    return { archived: form, next };
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
}

module.exports = new OperationalComplianceFormService();
