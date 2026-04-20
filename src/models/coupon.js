/**
 * Mongoose model for coupon collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['PERCENTAGE', 'FIXED'],
      required: true,
    },
    value: {
      type: Number,
      required: true,
    },
    maxDiscount: {
      type: Number, // Only applies to PERCENTAGE type
      default: null,
    },
    usageLimit: {
      type: String,
      // enum: ['ONCE', 'TWICE', 'MONTHLY', 'NOLIMIT'],
      enum: ['NOLIMIT'],
      default: 'NOLIMIT',
    },
    validFrom: { type: Date, default: null },
    validTill: { type: Date, default: null },
    adminCreated: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
    },
    isActive: {
      type: Boolean,
      default: true,
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

module.exports = new mongoose.model('coupons', mSchema);
