/**
 * Mongoose model for menu-categories collection
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
    description: {
      type: String,
      default: null,
    },
    imgUrls: [
      {
        type: String,
        default: null,
      },
    ],
    strikePrice: {
      type: Number,
      default: null
    },
    discountType: {
      type: String,
      enum: ['PERCENTAGE', 'FIXED','BOGO','BOGOHO'],
      default: 'FIXED',
    },
    hasDiscount: { type: Boolean, default: false },
    discountMode: {
      type: String,
      enum: ['CUSTOM', 'PREDEFINED'],
      default: 'CUSTOM',
    },
    predefinedDiscountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'common-data-list', // reference if you have predefined discount list
      default: null,
    },
    discountValue: {
      type: Number,
      default: 0,
    },
    discountRules: {
      buyQty: { type: Number, default: 1 },
      getQty: { type: Number, default: 1 },
      discount: { type: Number, default: 0 }, // 1.0 = 100% off, 0.5 = 50% off
      repeatable: { type: Boolean, default: true },
    },
    bogoItems: [
      {
        itemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'menu-items',
          default: null,
        },
        qty: {
          type: Number,
          default: 1,
        },
        isSameItem: {
          type: Boolean,
          default: false,
        },
      },
    ],
    discount: {
      type: Number,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
    },
    minQty: {
      type: Number,
      default: 1,
    },
    maxQty: {
      type: Number,
      default: 10,
    },
    available: {
      type: Boolean,
      default: true,
    },
    itemType: {
      type: String,
      enum: ['INDIVIDUAL', 'COMBO'],
      default: 'individual',
    },
    meatWellness: {
      type: String,
      default: null,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'menu-categories',
      required: true,
    },
    meatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'meats',
      default: null,
    },
    preparationTime: {
      type: Number,
      default: null,
    },
    allowCustomize: {
      type: Boolean,
      default: false,
    },
    newDish: {
      type: Boolean,
      default: false,
    },
    popularDish: {
      type: Boolean,
      default: false,
    },
    diet: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'diets',
      },
    ],
    subItem: [
      {
        menuItem: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'menu-items',
          required: true,
        },
        qty: {
          type: Number,
          default: 1,
        },
      },
    ],
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
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

module.exports = new mongoose.model('menu-items', mSchema);
