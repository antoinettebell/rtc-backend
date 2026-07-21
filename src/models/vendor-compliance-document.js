const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const {
  DOCUMENT_TYPES,
  OCR_STATUSES,
  REVIEW_STATUSES,
} = require('../helper/vendor-compliance-config');

const mSchema = mongoose.Schema(
  {
    document_id: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    document_type: {
      type: String,
      enum: Object.keys(DOCUMENT_TYPES),
      required: true,
      index: true,
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    title: {
      type: String,
      default: null,
    },
    file_url: {
      type: String,
      required: true,
    },
    file_key: {
      type: String,
      default: null,
    },
    original_name: {
      type: String,
      default: null,
    },
    mime_type: {
      type: String,
      default: null,
    },
    size_bytes: {
      type: Number,
      default: null,
      min: 0,
    },
    issue_date: {
      type: Date,
      default: null,
    },
    expiration_date: {
      type: Date,
      default: null,
      index: true,
    },
    extracted_fields: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ocr_status: {
      type: String,
      enum: OCR_STATUSES,
      default: 'not_configured',
      index: true,
    },
    ocr_requested_at: {
      type: Date,
      default: null,
    },
    ocr_completed_at: {
      type: Date,
      default: null,
    },
    ocr_error_message: {
      type: String,
      default: null,
    },
    review_status: {
      type: String,
      enum: REVIEW_STATUSES,
      default: 'pending_review',
      index: true,
    },
    review_notes: {
      type: String,
      default: null,
    },
    reviewed_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    reviewed_at: {
      type: Date,
      default: null,
    },
    uploaded_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    archived_at: {
      type: Date,
      default: null,
    },
    archived_reason: {
      type: String,
      default: null,
    },
    archived_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    replaced_by_document_id: {
      type: String,
      default: null,
    },
    reminder_days_sent: {
      type: [Number],
      default: [],
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

mSchema.index({
  food_truck_id: 1,
  document_type: 1,
  review_status: 1,
  archived_at: 1,
});

module.exports = new mongoose.model('vendor_compliance_documents', mSchema);
