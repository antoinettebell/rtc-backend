/**
 * Mongoose model for order collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    foodTruckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
    },
    sequenceValue: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('order-counters', mSchema);
