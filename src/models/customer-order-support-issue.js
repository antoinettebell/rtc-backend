const mongoose = require('mongoose');

// One record per order prevents a customer from submitting the same order until
// a refund is eventually issued.  These records are also the source of truth
// for the rolling 30-day automatic-refund policy.
const mSchema = mongoose.Schema(
  {
    order_id: { type: mongoose.Schema.Types.ObjectId, ref: 'orders', required: true, unique: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    issue_type: {
      type: String,
      enum: ['FOOD_NOT_DELIVERED', 'FOOD_QUALITY', 'OTHER'],
      required: true,
    },
    outcome: {
      type: String,
      enum: ['AUTO_REFUND', 'ESCALATED', 'REFUND_FAILED'],
      required: true,
      index: true,
    },
    refund_percentage: { type: Number, default: 0 },
    refund_amount: { type: Number, default: 0 },
    refund_transaction_id: { type: String, default: null },
    support_notified_at: { type: Date, default: null },
  },
  { timestamps: true }
);

mSchema.index({ user_id: 1, issue_type: 1, createdAt: -1 });

module.exports = mongoose.model('customer-order-support-issues', mSchema);
