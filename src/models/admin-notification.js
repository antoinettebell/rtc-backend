/**
 * Mongoose model for admin notification collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    recipientType: {
      type: String,
      enum: ['ALL_USERS', 'ALL_VENDORS', 'ALL_CUSTOMERS'],
      required: true,
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    sentTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'users',
      },
    ],
    sentAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('admin_notifications', mSchema);
