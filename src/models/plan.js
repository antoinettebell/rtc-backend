/**
 * Mongoose model for plan collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    titleColor: {
      type: String,
      default: null,
    },
    slug: {
      type: String,
      required: true,
    },
    rate: {
      type: Number,
      default: 0,
    },
    rateType: {
      type: String,
      default: null,
    },
    isPopular: {
      type: Boolean,
      default: false,
    },
    details: [
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

module.exports = new mongoose.model('plans', mSchema);
