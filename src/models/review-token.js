/**
 * Mongoose model for one-time walkup review tokens.
 */
const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    token_hash: {
      type: String,
      required: true,
      unique: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'orders',
      required: true,
      index: true,
    },
    foodTruckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    guest_phone: {
      type: String,
      default: null,
    },
    expires_at: {
      type: Date,
      required: true,
      index: true,
    },
    used_at: {
      type: Date,
      default: null,
      index: true,
    },
    review_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'reviews',
      default: null,
    },
    sent_at: {
      type: Date,
      default: null,
      index: true,
    },
    send_status: {
      type: String,
      enum: ['PENDING', 'SENT', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    send_error: {
      type: String,
      default: null,
    },
    send_active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

mSchema.index(
  { orderId: 1 },
  {
    unique: true,
    partialFilterExpression: { send_active: true },
  }
);

module.exports = new mongoose.model('review-tokens', mSchema);
