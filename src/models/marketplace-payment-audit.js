const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    audit_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    payment_id: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ['CREATE', 'CALL_INITIATED', 'CHECKOUT_PAID', 'CHECKOUT_FAILED', 'ADMIN_MARK_PAID'],
      required: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    actor_user_type: {
      type: String,
      default: null,
    },
    note: {
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

module.exports = new mongoose.model('marketplace-payment-audits', mSchema);
