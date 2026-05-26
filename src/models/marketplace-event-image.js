const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    image_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    event_id: {
      type: String,
      required: true,
      index: true,
    },
    image_url: {
      type: String,
      required: true,
    },
    image_key: {
      type: String,
      default: null,
    },
    uploaded_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
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

module.exports = new mongoose.model('marketplace-event-images', mSchema);
