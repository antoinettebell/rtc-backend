/**
 * Mongoose model for review collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    foodTruckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'orders',
      default: null,
    },
    rate: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
      validate: Number.isInteger,
    },
    review: {
      type: String,
      default: null,
    },
    images: [
      {
        type: String,
        default: null,
      },
    ],
    review_source: {
      type: String,
      enum: ['CUSTOMER_APP', 'WALKUP_SMS'],
      default: 'CUSTOMER_APP',
    },
    guest_phone: {
      type: String,
      default: null,
    },
    truckId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    status: {
      type: String,
      enum: ['PUBLISHED', 'HIDDEN', 'REJECTED'],
      default: 'PUBLISHED',
      index: true,
    },
    moderation_reason: {
      type: String,
      default: null,
    },
    moderated_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    moderated_at: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
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
    partialFilterExpression: {
      orderId: { $type: 'objectId' },
      deletedAt: null,
    },
  }
);
mSchema.index({ foodTruckId: 1, status: 1, deletedAt: 1 });
mSchema.index({ userId: 1, createdAt: -1 });

module.exports = new mongoose.model('reviews', mSchema);
