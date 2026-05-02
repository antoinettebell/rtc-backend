/**
 * Mongoose model for order collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    foodTruckId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    createdByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    orderSource: {
      type: String,
      enum: ['CUSTOMER_APP', 'VENDOR_POS'],
      default: 'CUSTOMER_APP',
    },
    guestCustomer: {
      phone: {
        type: String,
        default: null,
      },
    },
    deliveryTime: {
      type: String,
      default: null,
    },
    deliveryDate: {
      type: Date,
      default: null,
    },
    pickupTime: {
      type: String,
      default: null,
    },
    fulfillmentType: {
      type: String,
      enum: ['PICKUP', 'DELIVERY'],
      default: 'PICKUP',
    },
    deliveryAddress: {
      type: String,
      default: null,
    },
    shipdayOrderCreatedAt: {
      type: Date,
      default: null,
    },
    shipdayResponse: {
      type: Object,
      default: null,
    },
    shipdayError: {
      type: Object,
      default: null,
    },
    locationId: {
      type: String,
      default: null,
    },
    availabilityId: {
      type: String,
      default: null,
    },
    items: [
      {
        menuItemId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'menu-items',
          required: true,
        },
        customization: {
          type: String,
          default: null,
        },
        selectedFlavors: [
          {
            type: String,
            default: null,
          },
        ],
        selectedToppings: [
          {
            type: String,
            default: null,
          },
        ],
        selectedDiscountFlavors: [
          {
            type: String,
            default: null,
          },
        ],
        selectedDiscountToppings: [
          {
            type: String,
            default: null,
          },
        ],
        optionsTotal: {
          type: Number,
          default: 0,
        },
        qty: {
          type: Number,
          default: 1,
        },
        price: {
          type: Number,
          default: 1,
        },
        total: {
          type: Number,
          default: 1,
        },
        imgUrls: [
          {
            type: String,
            default: null,
          },
        ],
        name: {
          type: String,
          required: true,
        },
        description: {
          type: String,
          default: null,
        },
        discountType: {
          type: String,
          default: null,
        },
        fullMenuItemData: {
          type: Object,
          default: null,
        },
      },
    ],
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'coupons',
      default: null,
    },
    subTotal: {
      type: Number,
      required: true,
    },
    subtotal: {
      type: Number,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    totalAfterDiscount: {
      type: Number,
      required: true,
    },
    taxAmount: {
      type: Number,
      required: true,
    },
    tax: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
    },
    tip: {
      type: Number,
      default: 0,
    },
    tips: {
      type: Number,
      default: 0,
    },
    paymentProcessingFee: {
      type: Number,
      required: true,
    },
    tipsAmount: {
      type: Number,
      default: 0,
    },
    total: {
      type: Number,
      required: true,
    },
    totalOrderCost: {
      type: Number,
      default: 0,
    },
    orderStatus: {
      type: String,
      enum: [
        'INITIATE',
        'CANCEL',
        'PLACED',
        'ACCEPTED',
        'REJECTED',
        'PREPARING',
        'READY_FOR_PICKUP',
        'COMPLETED',
      ],
    },
    status: {
      type: String,
      default: 'PLACED',
    },
    cancelReason: {
      type: String,
      default: null,
    },
    statusTime: {
      canceledAt: {
        type: Date,
        default: null,
      },
      placedAt: {
        type: Date,
        default: null,
      },
      acceptedAt: {
        type: Date,
        default: null,
      },
      rejectedAt: {
        type: Date,
        default: null,
      },
      preparingAt: {
        type: Date,
        default: null,
      },
      readyAt: {
        type: Date,
        default: null,
      },
      completedAt: {
        type: Date,
        default: null,
      },
    },
    orderNumber: {
      type: Number,
      required: true,
    },
    freeDessertAmount: {
      type: Number,
      default: 0,
    },
    isFreeDessertEligible: {
      type: Boolean,
      default: false,
    },
    freeDessertApplied: {
      type: Boolean,
      default: false,
    },
    paymentMethod: {
      type: String,
      enum: ['COD', 'CASH', 'APPLE_PAY', 'GOOGLE_PAY', 'CARD', 'TAP_TO_PAY', 'STRIPE'],
      default: 'COD',
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    transactionId: {
      type: String,
      default: null,
    },
    authCode: {
      type: String,
      default: null,
    },
    accountNumber: {
      type: String,
      default: null,
    },
    accountType: {
      type: String,
      default: null,
    },
    invoiceNumber: {
      type: String,
      default: null,
    },
    refundTransactionId: {
      type: String,
      default: null,
    },
    refundDateTime: {
      type: Date,
      default: null,
    },
    refundStatus: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
      default: null,
    },
    refundReason: {
      type: String,
      default: null,
    },
    refundErrorMessage: {
      type: String,
      default: null,
    },
    refundMode: {
      type: String,
      enum: ['VOID', 'REFUND'],
      default: null,
    },
    locationData: {
      type: Object,
      default: null,
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

module.exports = new mongoose.model('orders', mSchema);
