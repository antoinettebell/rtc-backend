const crypto = require('crypto');
const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    request_id: {
      type: String,
      unique: true,
      immutable: true,
      default: () => `RCR-${crypto.randomUUID()}`,
    },
    order_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'orders',
      required: true,
      index: true,
    },
    employee_internal_id: {
      type: String,
      required: true,
      index: true,
    },
    employee_login_id: {
      type: String,
      required: true,
    },
    employee_session_id: {
      type: String,
      default: null,
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
    request_type: {
      type: String,
      enum: ['REFUND', 'CANCEL'],
      required: true,
    },
    reason_code: {
      type: String,
      enum: [
        'customer changed mind',
        'wrong item entered',
        'duplicate order',
        'payment issue',
        'food unavailable',
        'customer complaint',
        'other',
      ],
      required: true,
    },
    employee_notes: {
      type: String,
      default: null,
    },
    request_status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    requested_at: {
      type: Date,
      default: Date.now,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
    reviewed_by_vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    vendor_response_notes: {
      type: String,
      default: null,
    },
    original_payment_method: {
      type: String,
      default: null,
    },
    original_order_status: {
      type: String,
      default: null,
    },
    original_payment_status: {
      type: String,
      default: null,
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
  { order_id: 1 },
  {
    unique: true,
    partialFilterExpression: { request_status: { $in: ['PENDING', 'REJECTED'] } },
  }
);

module.exports = mongoose.model(
  'employee-refund-cancel-requests',
  mSchema,
  'employee_refund_cancel_requests'
);
