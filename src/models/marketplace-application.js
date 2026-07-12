const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    application_id: {
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
    business_name: {
      type: String,
      default: null,
    },
    contact_name: {
      type: String,
      default: null,
    },
    phone: {
      type: String,
      default: null,
    },
    email: {
      type: String,
      default: null,
    },
    food_type_cuisine: {
      type: String,
      default: null,
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
    application_status: {
      type: String,
      enum: [
        'DRAFT',
        'PENDING_SIGNATURE',
        'SUBMITTED',
        'UNDER_REVIEW',
        'ACCEPTED',
        'PAYMENT_DUE',
        'PAID',
        'CONFIRMED',
        'NOT_SELECTED',
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
    paid_at: {
      type: Date,
      default: null,
    },
    archived_at: {
      type: Date,
      default: null,
      index: true,
    },
    archived_reason: {
      type: String,
      default: null,
    },
    transaction_id: {
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

module.exports = new mongoose.model('marketplace-applications', mSchema);
