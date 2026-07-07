const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    agreement_id: {
      type: String,
      default: uuidv4,
      unique: true,
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
      default: null,
      index: true,
    },
    event_id: {
      type: String,
      default: null,
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
    envelope_id: {
      type: String,
      default: null,
      index: true,
    },
    governance_template_id: {
      type: String,
      required: true,
    },
    nda_template_id: {
      type: String,
      required: true,
    },
    governance_version: {
      type: String,
      default: '1.0',
    },
    nda_version: {
      type: String,
      default: '1.0',
    },
    signer_role: {
      type: String,
      default: 'VendorSigner',
    },
    signer_name: {
      type: String,
      default: null,
    },
    signer_email: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        'NOT_STARTED',
        'PENDING_SIGNATURE',
        'SENT',
        'VIEWED',
        'SIGNED',
        'CANCELLED',
        'DECLINED',
        'VOIDED',
        'ERROR',
      ],
      default: 'NOT_STARTED',
      index: true,
    },
    signed_at: {
      type: Date,
      default: null,
    },
    expires_at: {
      type: Date,
      default: null,
      index: true,
    },
    return_status: {
      type: String,
      default: null,
    },
    error_message: {
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

module.exports = new mongoose.model('marketplace-vendor-agreements', mSchema);
