const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    employee_internal_id: { type: String, required: true, index: true },
    employee_name: { type: String, required: true, trim: true },
    form_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'operational_compliance_forms',
      required: true,
      index: true,
    },
    form_type: {
      type: String,
      enum: ['INVENTORY', 'OPENING_CHECKLIST', 'CLOSING_CHECKLIST'],
      required: true,
    },
    action: { type: String, enum: ['SAVED', 'SUBMITTED'], required: true },
    event_key: { type: String, required: true, unique: true, index: true },
    food_truck_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    truck_unit_id: { type: String, default: null },
    location_id: { type: String, default: null },
    occurred_at: { type: Date, default: Date.now, index: true },
    acknowledged_at: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

schema.index({ vendor_user_id: 1, occurred_at: -1 });

module.exports = mongoose.model('operational_notifications', schema);
