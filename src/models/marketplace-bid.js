const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    bid_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    event_id: {
      type: String,
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
    submission_round: {
      type: Number,
      default: 1,
      min: 1,
      index: true,
    },
    price_per_guest: {
      type: Number,
      default: null,
      min: 0,
    },
    average_price_per_meal: {
      type: Number,
      default: null,
      min: 0,
    },
    full_bid_amount: {
      type: Number,
      required: true,
      min: 0,
    },
    menu_description: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    menu_pdf_url: {
      type: String,
      default: null,
    },
    menu_pdf_key: {
      type: String,
      default: null,
    },
    image_urls: {
      type: [String],
      default: [],
    },
    image_keys: {
      type: [String],
      default: [],
    },
    permit_license_urls: {
      type: [String],
      default: [],
    },
    permit_license_keys: {
      type: [String],
      default: [],
    },
    agreement_document_url: {
      type: String,
      default: null,
    },
    agreement_document_key: {
      type: String,
      default: null,
    },
    insurance_confirmed: {
      type: Boolean,
      default: false,
    },
    permits_confirmed: {
      type: Boolean,
      default: false,
    },
    liquor_license_confirmed: {
      type: Boolean,
      default: false,
    },
    nda_required: {
      type: Boolean,
      default: false,
    },
    nda_acknowledged: {
      type: Boolean,
      default: false,
    },
    nda_acknowledged_at: {
      type: Date,
      default: null,
    },
    agreement_provider: {
      type: String,
      enum: ['NONE', 'DOCUSIGN'],
      default: 'NONE',
    },
    agreement_status: {
      type: String,
      enum: [
        'NOT_REQUIRED',
        'ACKNOWLEDGED',
        'PENDING_SIGNATURE',
        'SENT',
        'VIEWED',
        'SIGNED',
        'DECLINED',
        'VOIDED',
        'ERROR',
      ],
      default: 'NOT_REQUIRED',
    },
    agreement_envelope_id: {
      type: String,
      default: null,
    },
    signed_document_url: {
      type: String,
      default: null,
    },
    agreement_sent_at: {
      type: Date,
      default: null,
    },
    agreement_signed_at: {
      type: Date,
      default: null,
    },
    signer_name: {
      type: String,
      default: null,
    },
    signer_email: {
      type: String,
      default: null,
    },
    agreement_error_message: {
      type: String,
      default: null,
    },
    bid_status: {
      type: String,
      enum: [
        'DRAFT',
        'SUBMITTED',
        'UNDER_REVIEW',
        'AWARDED',
        'NOT_AWARDED',
        'WITHDRAWN',
      ],
      default: 'DRAFT',
      index: true,
    },
    payment_id: {
      type: String,
      default: null,
      index: true,
    },
    payment_status: {
      type: String,
      enum: ['NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'NOT_REQUIRED',
      index: true,
    },
    submitted_at: {
      type: Date,
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

module.exports = new mongoose.model('marketplace-bids', mSchema);
