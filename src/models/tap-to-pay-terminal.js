const mongoose = require('mongoose');

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true, trim: true },
    actor_type: { type: String, trim: true, default: null },
    actor_id: { type: mongoose.Schema.Types.ObjectId, default: null },
    reason: { type: String, trim: true, maxlength: 500, default: null },
    occurred_at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const schema = new mongoose.Schema(
  {
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    assigned_user_type: {
      type: String,
      enum: ['VENDOR', 'EMPLOYEE'],
      required: true,
    },
    assigned_user_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    employee_internal_id: { type: String, trim: true, default: null },
    device_id: { type: String, required: true, trim: true },
    device_id_suffix: { type: String, trim: true, default: null },
    device_label: { type: String, trim: true, maxlength: 120, default: 'iPhone' },
    environment: {
      type: String,
      enum: ['PRODUCTION', 'TEST'],
      default: 'PRODUCTION',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'HISTORICAL'],
      default: 'ACTIVE',
      index: true,
    },
    reactivation_required: { type: Boolean, default: false },
    reactivation_requested_at: { type: Date, default: null },
    reactivation_requested_by: { type: mongoose.Schema.Types.ObjectId, default: null },
    reactivation_reason: { type: String, trim: true, maxlength: 500, default: null },
    reactivation_completed_at: { type: Date, default: null },
    registered_at: { type: Date, default: Date.now },
    last_seen_at: { type: Date, default: Date.now },
    last_activation_status: {
      type: String,
      enum: ['UNKNOWN', 'PENDING', 'SUCCEEDED', 'FAILED'],
      default: 'UNKNOWN',
    },
    activation_attempt_count: { type: Number, default: 0, min: 0 },
    last_activation_at: { type: Date, default: null },
    last_activation_error_code: { type: String, trim: true, maxlength: 120, default: null },
    last_activation_error_message: { type: String, trim: true, maxlength: 500, default: null },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

schema.index({ food_truck_id: 1, device_id: 1 }, { unique: true });
schema.index({ food_truck_id: 1, status: 1, last_seen_at: -1 });

module.exports = mongoose.model('tap_to_pay_terminals', schema);
