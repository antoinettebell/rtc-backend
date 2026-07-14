const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    payment_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    event_id: {
      type: String,
      required: true,
      index: true,
    },
    bid_id: {
      type: String,
      default: null,
      index: true,
    },
    application_id: {
      type: String,
      default: null,
      index: true,
    },
    selected_bid_ids: {
      type: [String],
      default: [],
    },
    payer_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    payer_type: {
      type: String,
      enum: ['CUSTOMER', 'VENDOR'],
      required: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      default: null,
      index: true,
    },
    payment_type: {
      type: String,
      enum: [
        'COORDINATOR_AWARD_FEE',
        'VENDOR_EVENT_FEE',
        'FINAL_EVENT_PAYMENT',
      ],
      required: true,
      index: true,
    },
    base_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    fee_rate: {
      type: Number,
      default: null,
      min: 0,
    },
    fee_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    tip_amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    total_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    coordinator_payout_amount: {
      type: Number,
      default: null,
      min: 0,
    },
    payment_method: {
      type: String,
      enum: ['APPLE_PAY', 'GOOGLE_PAY', 'TAP_TO_PAY', 'ADMIN_MANUAL'],
      default: null,
    },
    payment_status: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'PENDING',
      index: true,
    },
    processor_transaction_id: {
      type: String,
      default: null,
    },
    paid_at: {
      type: Date,
      default: null,
    },
    manually_marked_paid: {
      type: Boolean,
      default: false,
    },
    marked_paid_by_admin_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    marked_paid_at: {
      type: Date,
      default: null,
    },
    manual_payment_reference: {
      type: String,
      default: null,
    },
    manual_payment_note: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

module.exports = new mongoose.model('marketplace-payments', mSchema);
