const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Coordinator provider records are intentionally separate from vendor records.
// They retain provider references and normalized outcomes only; never raw tax
// identifiers, document images, OCR text, request URLs, or provider payloads.
const schema = new mongoose.Schema(
  {
    verification_id: { type: String, default: uuidv4, unique: true, index: true },
    coordinator_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
    verification_cycle: { type: Number, required: true, min: 1, index: true },
    provider: { type: String, enum: ['COMPLYCUBE', 'COBALT'], required: true, index: true },
    check_type: { type: String, enum: ['SSN', 'TIN', 'SOS'], required: true, index: true },
    status: {
      type: String,
      enum: ['NOT_STARTED', 'PENDING', 'PASSED', 'FAILED', 'MANUAL_REVIEW', 'RETRYABLE_ERROR', 'SUPERSEDED'],
      default: 'NOT_STARTED',
      index: true,
    },
    provider_reference: { type: String, default: null, index: true },
    provider_client_reference: { type: String, default: null },
    request_fingerprint: { type: String, default: null },
    safe_result_code: { type: String, default: null },
    safe_reason: { type: String, default: null },
    submitted_at: { type: Date, default: null },
    completed_at: { type: Date, default: null },
    webhook_event_reference: { type: String, default: null, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

schema.index({ coordinator_user_id: 1, verification_cycle: 1, provider: 1, check_type: 1 });
schema.index({ provider: 1, webhook_event_reference: 1 }, { sparse: true });

module.exports = mongoose.model('coordinator_compliance_provider_verifications', schema);
