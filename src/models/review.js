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
      required: true,
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
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('reviews', mSchema);
