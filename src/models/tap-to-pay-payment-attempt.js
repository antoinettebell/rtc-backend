const crypto = require('crypto');
const mongoose = require('mongoose');

const schema = mongoose.Schema(
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
    employee_internal_id: {
      type: String,
      default: null,
      index: true,
    },
    actor_type: {
      type: String,
      enum: ['VENDOR', 'EMPLOYEE'],
      required: true,
    },
    checkout_key: {
      type: String,
      required: true,
      immutable: true,
    },
    order_number: {
      type: Number,
      required: true,
    },
    reference: {
      type: String,
      unique: true,
      immutable: true,
      // Keep the merchant reference within the strictest processor limit.
      default: () => `R${crypto.randomBytes(4).toString('hex').slice(0, 7)}`,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
    },
    status: {
      type: String,
      enum: [
        'PREPARED',
        'PROCESSING',
        'FINALIZING',
        'COMPLETED',
        'CANCELED',
        'DECLINED',
        'REVIEW_REQUIRED',
      ],
      default: 'PREPARED',
      index: true,
    },
    started_at: { type: Date, default: null },
    next_reconciliation_at: { type: Date, default: null, index: true },
    last_reconciliation_at: { type: Date, default: null },
    reconciliation_attempts: { type: Number, default: 0 },
    completed_at: { type: Date, default: null },
    canceled_at: { type: Date, default: null },
    declined_at: { type: Date, default: null },
    transaction_id: { type: String, default: null },
    notification_sent_at: { type: Date, default: null },
    last_reconciliation_error_at: { type: Date, default: null },
  },
  { timestamps: true }
);

schema.index({ status: 1, next_reconciliation_at: 1 });
schema.index({ food_truck_id: 1, order_number: 1 }, { unique: true });
schema.index({ vendor_user_id: 1, checkout_key: 1 }, { unique: true });

module.exports = mongoose.model('tap-to-pay-payment-attempts', schema);
