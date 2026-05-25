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
    payoutTimingLabel: {
      type: String,
      default: null,
    },
    capabilities: {
      payoutTiming: {
        type: String,
        enum: ['THREE_DAY', 'DAILY', null],
        default: null,
      },
      employeeLogin: {
        type: Boolean,
        default: false,
      },
      employeeWalkUpPos: {
        type: Boolean,
        default: false,
      },
      walkUpPosPaymentMethods: [
        {
          type: String,
          enum: ['CASH', 'TAP_TO_PAY'],
        },
      ],
      tapToPay: {
        type: Boolean,
        default: false,
      },
      eventMarketplace: {
        type: Boolean,
        default: false,
      },
      maxSocialMediaLinks: {
        type: Number,
        default: 0,
      },
      newDishHighlight: {
        type: Boolean,
        default: false,
      },
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
