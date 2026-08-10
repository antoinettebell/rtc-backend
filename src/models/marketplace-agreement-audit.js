const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    audit_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    event_id: {
      type: String,
      required: true,
      index: true,
    },
    payment_id: {
      type: String,
      default: null,
      index: true,
    },
    agreement_envelope_id: {
      type: String,
      default: null,
      index: true,
    },
    agreement_id: { type: String, default: null, index: true },
    vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null, index: true },
    event_vendor_profile_id: { type: String, default: null, index: true },
    application_id: { type: String, default: null, index: true },
    action: {
      type: String,
      enum: [
        'ENVELOPE_CREATED', 'ENVELOPE_REUSED', 'RETURN_RECEIVED',
        'RECONCILIATION_ATTEMPT', 'STATUS_REFRESHED', 'RETRY_SCHEDULED',
        'SIGNED_DOCUMENT_RETRIEVED', 'APPLICATION_FINALIZED',
        'WEBHOOK_RECEIVED', 'ERROR',
      ],
      required: true,
    },
    agreement_status: {
      type: String,
      default: null,
    },
    source: {
      type: String,
      enum: ['SYSTEM', 'DOCUSIGN_WEBHOOK', 'USER_REFRESH', 'APP_RETURN', 'APP_RESUME'],
      default: 'SYSTEM',
    },
    message: {
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

module.exports = new mongoose.model('marketplace-agreement-audits', mSchema);
