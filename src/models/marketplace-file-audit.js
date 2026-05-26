const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    audit_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    attachment_id: {
      type: String,
      required: true,
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
    action: {
      type: String,
      enum: ['VIEW', 'DOWNLOAD', 'ARCHIVE', 'DELETE', 'FLAG'],
      required: true,
      index: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    actor_user_type: {
      type: String,
      default: null,
    },
    reason: {
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

module.exports = new mongoose.model('marketplace-file-audits', mSchema);
