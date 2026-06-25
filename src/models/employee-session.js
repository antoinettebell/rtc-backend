/**
 * Mongoose model for employee session collection
 */
const crypto = require('crypto');
const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    employee_session_id: {
      type: String,
      unique: true,
      immutable: true,
      default: () => `ES-${crypto.randomUUID()}`,
    },
    employee_internal_id: {
      type: String,
      required: true,
      index: true,
    },
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
    location_id: {
      type: String,
      required: true,
      index: true,
    },
    started_at: {
      type: Date,
      default: Date.now,
    },
    ended_at: {
      type: Date,
      default: null,
    },
    last_active_at: {
      type: Date,
      default: Date.now,
    },
    paused_at: {
      type: Date,
      default: null,
    },
    resumed_at: {
      type: Date,
      default: null,
    },
    break_started_at: {
      type: Date,
      default: null,
    },
    break_ended_at: {
      type: Date,
      default: null,
    },
    total_break_minutes: {
      type: Number,
      default: 0,
    },
    break_count: {
      type: Number,
      default: 0,
    },
    shift_status: {
      type: String,
      enum: ['STARTED', 'ON_BREAK', 'ENDED'],
      default: 'STARTED',
      index: true,
    },
    is_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

mSchema.index(
  { employee_internal_id: 1, is_active: 1 },
  {
    unique: true,
    partialFilterExpression: { is_active: true },
  }
);

module.exports = mongoose.model(
  'employee-sessions',
  mSchema,
  'employee_sessions'
);
