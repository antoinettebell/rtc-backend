/**
 * Mongoose model for cuisine collection
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
    key: { type: String, required: true }, 
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    type: {
      type: String,
      enum: ["discount", "meat_wellness"],
      default: "string",
    },
    inactive: {
        type: Boolean,
        required: false,
        default: false,
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

module.exports = new mongoose.model('common-data-list', mSchema);
