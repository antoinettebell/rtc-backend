const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    attachment_id: {
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
    attachment_type: {
      type: String,
      enum: [
        'EVENT_IMAGE',
        'BID_MENU_PDF',
        'BID_IMAGE',
        'APPLICATION_MENU_PDF',
        'APPLICATION_IMAGE',
        'PERMIT_LICENSE',
        'AGREEMENT_DOCUMENT',
        'REQUIREMENT_DOCUMENT',
      ],
      required: true,
      index: true,
    },
    requirement_label: {
      type: String,
      default: null,
      trim: true,
      index: true,
    },
    requirement_key: {
      type: String,
      default: null,
      trim: true,
      index: true,
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
    uploaded_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'ARCHIVED', 'DELETED', 'FLAGGED'],
      default: 'ACTIVE',
      index: true,
    },
    status_reason: {
      type: String,
      default: null,
    },
    status_updated_at: {
      type: Date,
      default: null,
    },
    status_updated_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    deleted_at: {
      type: Date,
      default: null,
    },
    deleted_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
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

module.exports = new mongoose.model('marketplace-attachments', mSchema);
