/**
 * Mongoose model for address collection
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
    title: {
      type: String,
      default: null,
    },
    address: {
      type: String,
      default: null,
    },
    lat: {
      type: String,
      default: null,
    },
    long: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('address', mSchema);
