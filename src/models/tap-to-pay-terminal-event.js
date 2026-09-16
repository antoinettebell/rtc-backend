const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    terminal_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'tap_to_pay_terminals',
      default: null,
    },
    actor_type: { type: String, enum: ['VENDOR', 'EMPLOYEE', 'SUPER_ADMIN'], required: true },
    actor_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    event_type: {
      type: String,
      enum: ['STATUS_CHECK', 'ACTIVATION_STARTED', 'ACTIVATION_SUCCEEDED', 'ACTIVATION_FAILED'],
      required: true,
    },
    environment: { type: String, enum: ['PRODUCTION', 'TEST'], default: 'PRODUCTION' },
    device_id_suffix: { type: String, trim: true, default: null },
    device_label: { type: String, trim: true, maxlength: 120, default: null },
    error_code: { type: String, trim: true, maxlength: 120, default: null },
    error_message: { type: String, trim: true, maxlength: 500, default: null },
    occurred_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

schema.index({ food_truck_id: 1, occurred_at: -1 });

module.exports = mongoose.model('tap_to_pay_terminal_events', schema);
