/**
 * Mongoose model for setting collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    termsConditions: {
      type: String,
      default: null,
    },
    privacyPolicy: {
      type: String,
      default: null,
    },
    agreement: {
      type: String,
      default: null,
    },
    freeDessertAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    freeDessertOrderCount: {
      type: Number,
      default: 10,
      min: 1,
    },
    isFreeDessertEnabled: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('settings', mSchema);
