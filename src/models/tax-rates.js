/**
 * Mongoose model for bank-detail collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    stateCode: {
      type: String,
      required: true,
    },
    slug: {
      type: String,
      required: true,
    },
    zip: {
      type: String,
      required: true,
    },
    taxRegion: {
      type: String,
      default: null,
    },
    estimatedCombineRate: {
      type: Number,
      default: 0,
    },
    stateRate: {
      type: Number,
      default: 0,
    },
    estimatedCountryRate: {
      type: Number,
      default: 0,
    },
    estimatedCityRate: {
      type: Number,
      default: 0,
    },
    estimatedSpecialRate: {
      type: Number,
      default: 0,
    },
    riskLevel: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('tax-rates', mSchema);
