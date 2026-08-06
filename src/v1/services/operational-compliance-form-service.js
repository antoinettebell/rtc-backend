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
      return {
        vendor_user_id: user.vendor_user_id,
        food_truck_id: user.food_truck_id,
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
    const query = { ...scope };
    if (type) {
      this.validateType(type);
      query.form_type = type;
    }
    if (status) query.status = status;
    return Model.find(query).sort({ form_date: -1, createdAt: -1 }).lean();
  }

  async getOrCreateDraft({ user, type }) {
    this.validateType(type);
    const scope = await this.getScope(user);
    const existing = await Model.findOne({
      ...scope,
      form_type: type,
      status: { $in: ['DRAFT', 'SUBMITTED'] },
    }).sort({ createdAt: -1 });
    if (existing) {
      if (!String(existing.prepared_by_name || '').trim()) {
        existing.prepared_by_name = preparedByName(user);
        await existing.save();
      }
      return existing;
    }

    return Model.create({
      ...scope,
      form_type: type,
      prepared_by_name: preparedByName(user),
      checklist_items: buildChecklistItems(type),
    });
  }

  async getScopedForm({ user, id }) {
    const scope = await this.getScope(user);
    const form = await Model.findOne({ _id: id, ...scope });
    if (!form) throw errorWithCode('Operational compliance form not found.', 404);
    return form;
  }

  async update({ user, id, payload }) {
    const form = await this.getScopedForm({ user, id });
    if (form.status !== 'DRAFT') {
      throw errorWithCode('Click the pencil to edit this submitted form.', 409);
    }

    editableFields.forEach((field) => {
      if (payload[field] !== undefined) form[field] = payload[field];
    });
    if (form.form_type === 'INVENTORY') {
      form.inventory_items = normalizeInventoryItems(form.inventory_items);
    }
    form.last_edited_at = new Date();
    form.last_edited_by_id = user._id;
    form.last_edited_by_type = actorType(user);
    return form.save();
  }

  async submit({ user, id, payload = {} }) {
    let form = await this.getScopedForm({ user, id });
    if (form.status !== 'DRAFT') {
      throw errorWithCode('Only a draft form can be submitted.', 409);
    }
    if (Object.keys(payload).length) {
      form = await this.update({ user, id, payload });
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
      CustomNotification.sendNotificationToUsers({
        [form.vendor_user_id.toString()]: {
          title: 'Operations form submitted',
          body: `${form.prepared_by_name || 'An employee'} submitted ${form.form_type
            .toLowerCase()
            .replaceAll('_', ' ')} for review. No approval is required.`,
          data: {
            activityType: 'OPERATIONAL_COMPLIANCE_SUBMITTED',
            formId: form._id.toString(),
            formType: form.form_type,
          },
        },
      }).catch((error) => {
        console.error('Operations form notification failed', {
          formId: form._id,
          message: error.message,
        });
      });
    }
    return form;
  }

  async unlock({ user, id }) {
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
}

module.exports = new OperationalComplianceFormService();
