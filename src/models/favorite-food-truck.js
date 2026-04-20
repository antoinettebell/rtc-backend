/**
 * Mongoose model for favorite-food-truck collection
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
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('favorite-food-trucks', mSchema);
