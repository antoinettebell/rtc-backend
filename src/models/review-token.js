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
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('review-tokens', mSchema);
