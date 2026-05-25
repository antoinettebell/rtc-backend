/**
 * Mongoose model for employee item availability audit collection
 */
const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    employee_internal_id: {
      type: String,
      required: true,
      index: true,
    },
    employee_session_id: {
      type: String,
      default: null,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    location_id: {
      type: String,
      required: true,
      index: true,
    },
    item_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'menu-items',
      required: true,
      index: true,
    },
    previous_status: {
      type: Boolean,
      required: true,
    },
    new_status: {
      type: Boolean,
      required: true,
    },
    changed_at: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    collection: 'employee_item_availability_audits',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

module.exports = mongoose.model('employee-item-availability-audits', mSchema);
