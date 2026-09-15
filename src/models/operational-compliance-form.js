const mongoose = require('mongoose');

const inventoryActionSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['CREATED', 'SAVED_DRAFT', 'SUBMITTED', 'ITEM_UPDATED', 'COUNT_CLOSED', 'REORDER_RECEIVED', 'ITEM_ARCHIVED'],
      required: true,
    },
    actor_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    actor_type: { type: String, enum: ['VENDOR', 'EMPLOYEE'], required: true },
    actor_name: { type: String, trim: true, maxlength: 80, default: '' },
    occurred_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const inventoryItemSchema = new mongoose.Schema(
  {
    item_location: { type: String, trim: true, maxlength: 80, default: '' },
    brand: { type: String, trim: true, maxlength: 80, default: '' },
    item_name: { type: String, trim: true, maxlength: 80, required: true },
    purchased_from: { type: String, trim: true, maxlength: 80, default: '' },
    date_purchased: { type: Date, default: null },
    use_by_date: { type: Date, default: null },
    beginning_quantity: { type: Number, min: 0, max: 100, default: 0 },
    current_quantity: { type: Number, min: 0, max: 100, default: 0 },
    max_quantity: { type: Number, min: 1, max: 100, default: 1 },
    reorder_quantity: { type: Number, min: 0, max: 100, default: 0 },
    reorder_resolved_at: { type: Date, default: null },
    notes: { type: String, trim: true, maxlength: 250, default: '' },
    lifecycle_status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED'],
      default: 'ACTIVE',
      index: true,
    },
    record_status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED'],
      default: 'DRAFT',
    },
    lineage_id: { type: String, default: null, index: true },
    source_form_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    source_item_id: { type: String, default: null },
    source_employee_internal_id: { type: String, default: null },
    applied_review_keys: { type: [String], default: [] },
    archived_at: { type: Date, default: null },
    archived_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    archive_reason: {
      type: String,
      enum: ['COUNT_CLOSED', 'ITEM_ARCHIVED', null],
      default: null,
    },
    expiration_notification_key: { type: String, default: null },
    pending_close_draft: { type: mongoose.Schema.Types.Mixed, default: null },
    pending_close_saved_at: { type: Date, default: null },
    pending_close_saved_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    actions: { type: [inventoryActionSchema], default: [] },
  },
  { _id: true }
);

const checklistItemSchema = new mongoose.Schema(
  {
    area: { type: String, trim: true, maxlength: 80, required: true },
    task: { type: String, trim: true, maxlength: 250, required: true },
    completed: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 250, default: '' },
  },
  { _id: true }
);

const schema = new mongoose.Schema(
  {
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    employee_internal_id: { type: String, default: null, index: true },
    employee_session_id: { type: String, default: null, index: true },
    truck_unit_id: { type: String, default: null, index: true },
    location_id: { type: String, default: null, index: true },
    form_type: {
      type: String,
      enum: ['INVENTORY', 'OPENING_CHECKLIST', 'CLOSING_CHECKLIST'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['DRAFT', 'SUBMITTED', 'ARCHIVED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },
    prepared_by_name: { type: String, trim: true, maxlength: 80, default: '' },
    initials: { type: String, trim: true, maxlength: 10, default: '' },
    truck_unit: { type: String, trim: true, maxlength: 80, default: '' },
    location_label: { type: String, trim: true, maxlength: 250, default: '' },
    form_date: { type: Date, default: Date.now },
    inventory_items: { type: [inventoryItemSchema], default: [] },
    checklist_items: { type: [checklistItemSchema], default: [] },
    submitted_at: { type: Date, default: null },
    submitted_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    submitted_by_type: { type: String, enum: ['VENDOR', 'EMPLOYEE', null], default: null },
    last_edited_at: { type: Date, default: null },
    last_edited_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    last_edited_by_type: { type: String, enum: ['VENDOR', 'EMPLOYEE', null], default: null },
    archived_at: { type: Date, default: null },
    archived_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    inventory_review_action: {
      type: String,
      enum: ['UPDATED', 'CLOSED_INTO_INVENTORY', 'ARCHIVED', null],
      default: null,
    },
    inventory_reviewed_at: { type: Date, default: null },
    inventory_reviewed_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    inventory_review_claimed_at: { type: Date, default: null },
    inventory_review_claim_action: {
      type: String,
      enum: ['UPDATED', 'CLOSED_INTO_INVENTORY', 'ARCHIVED', null],
      default: null,
    },
    inventory_review_claimed_by_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    source_archive_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'operational_compliance_forms',
      default: null,
      index: true,
    },
    notification_pending_action: {
      type: String,
      enum: ['SAVED', 'SUBMITTED', null],
      default: null,
      index: true,
    },
    notification_event_key: { type: String, default: null },
    notification_error: { type: String, default: null },
  },
  { timestamps: true }
);

schema.index({ food_truck_id: 1, form_type: 1, status: 1, createdAt: -1 });
schema.index({ employee_session_id: 1, form_type: 1, status: 1 });
schema.index({ food_truck_id: 1, truck_unit_id: 1, location_id: 1, form_type: 1, status: 1 });
schema.index(
  { employee_session_id: 1, form_type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      employee_session_id: { $type: 'string' },
      status: { $in: ['DRAFT', 'SUBMITTED'] },
    },
  }
);

module.exports = mongoose.model('operational_compliance_forms', schema);
