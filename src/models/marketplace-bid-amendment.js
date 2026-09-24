const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = mongoose.Schema(
  {
    amendment_id: { type: String, default: uuidv4, unique: true },
    event_id: { type: String, required: true, index: true },
    original_bid_id: { type: String, required: true, index: true },
    replacement_bid_id: { type: String, default: null, index: true },
    coordinator_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    previous_vip_guest_count: { type: Number, required: true, min: 0 },
    requested_vip_guest_count: { type: Number, required: true, min: 0 },
    editable_amount_field: {
      type: String,
      enum: ['full_bid_amount', 'vip_catering_amount'],
      required: true,
    },
    original_amount: { type: Number, required: true, min: 0 },
    proposed_amount: { type: Number, default: null, min: 0 },
    response_type: {
      type: String,
      enum: ['RECONFIRMED', 'REVISED', null],
      default: null,
    },
    status: {
      type: String,
      enum: ['AWAITING_VENDOR', 'PENDING_REVIEW', 'ACCEPTED', 'REJECTED'],
      default: 'AWAITING_VENDOR',
      index: true,
    },
    requested_at: { type: Date, default: Date.now },
    vendor_responded_at: { type: Date, default: null },
    reviewed_at: { type: Date, default: null },
    reviewed_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    rejection_reason: { type: String, default: null, maxlength: 500 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  }
);

schema.index(
  { event_id: 1, original_bid_id: 1, status: 1 },
  { name: 'marketplace_bid_amendment_lookup' }
);

module.exports = mongoose.model('marketplace-bid-amendments', schema);
