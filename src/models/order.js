/**
 * Mongoose model for order collection
 */
const mongoose = require('mongoose');

const toPhoneDigits = (value) =>
  value === null || value === undefined ? value : String(value).replace(/\D/g, '');

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
    createdByEmployeeInternalId: {
      type: String,
      default: null,
    },
    created_by_type: {
      type: String,
      enum: ['CUSTOMER', 'VENDOR', 'EMPLOYEE', null],
      default: null,
    },
    employee_internal_id: {
      type: String,
      default: null,
    },
    employee_session_id: {
      type: String,
      default: null,
    },
    employee_login_id: {
      type: String,
      default: null,
    },
    employee_name: {
      type: String,
      default: null,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      default: null,
    },
    location_id: {
      type: String,
      default: null,
    },
    truck_unit_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    truck_unit_name: {
      type: String,
      default: null,
    },
    truck_unit_phone: {
      type: String,
      default: null,
      set: toPhoneDigits,
    },
    order_source: {
      type: String,
      enum: ['CUSTOMER_APP', 'VENDOR_POS', 'WALK_UP_EMPLOYEE', null],
      default: null,
    },
    payment_method: {
      type: String,
      default: null,
    },
    vendor_tier_at_transaction: {
      type: Object,
      default: null,
    },
    created_at: {
      type: Date,
      default: null,
    },
    completed_at: {
      type: Date,
      default: null,
    },
    orderSource: {
      type: String,
      enum: ['CUSTOMER_APP', 'VENDOR_POS', 'WALK_UP_EMPLOYEE'],
      default: 'CUSTOMER_APP',
    },
    guestCustomer: {
      phone: {
        type: String,
        default: null,
        set: toPhoneDigits,
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
    deliveryLat: {
      type: String,
      default: null,
    },
    deliveryLong: {
      type: String,
      default: null,
    },
    deliveryDistanceMiles: {
      type: Number,
      default: null,
    },
    deliveryRadiusMiles: {
      type: Number,
      default: null,
    },
    deliveryValidation: {
      type: Object,
      default: null,
    },
    avalaraTaxAmount: {
      type: Number,
      default: 0,
    },
    avalaraEstimateStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: null,
    },
    avalaraEstimateError: {
      type: Object,
      default: null,
    },
    avalaraEstimateResponse: {
      type: Object,
      default: null,
    },
    avalaraTransactionCode: {
      type: String,
      default: null,
    },
    avalaraTransactionId: {
      type: String,
      default: null,
    },
    avalaraCommitStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: null,
    },
    avalaraCommittedAt: {
      type: Date,
      default: null,
    },
    avalaraResponse: {
      type: Object,
      default: null,
    },
    avalaraError: {
      type: Object,
      default: null,
    },
    shipdayOrderCreatedAt: {
      type: Date,
      default: null,
    },
    shipdayCreationStartedAt: {
      type: Date,
      default: null,
    },
    shipdayCreationStatus: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED'],
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
    shipdayStatusResponse: {
      type: Object,
      default: null,
    },
    shipdayStatusError: {
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
        selectedDiscountCustomization: {
          type: String,
          default: null,
        },
        selectedDiscountComboSides: [
          {
            type: String,
            default: null,
          },
        ],
        selectedComboSides: [
          {
            type: String,
            default: null,
          },
        ],
        comboItems: {
          type: [Object],
          default: [],
        },
        selectedDiscountSubItems: {
          type: [Object],
          default: [],
        },
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
        'DRIVER_PICKED_UP',
        'DELIVERED',
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
      driverPickedUpAt: {
        type: Date,
        default: null,
      },
      deliveredAt: {
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
