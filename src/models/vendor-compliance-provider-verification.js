const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Provider records intentionally contain references and normalized outcomes only.
// Never add raw tax identifiers, request URLs, or raw provider payloads here.
const mSchema = mongoose.Schema(
  {
    verification_id: { type: String, default: uuidv4, unique: true, index: true },
    food_truck_id: { type: mongoose.Schema.Types.ObjectId, ref: 'food-trucks', required: true, index: true },
    vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
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
    retry_count: { type: Number, default: 0, min: 0 },
    webhook_event_reference: { type: String, default: null, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

mSchema.index({ food_truck_id: 1, verification_cycle: 1, provider: 1, check_type: 1 });
mSchema.index({ provider: 1, webhook_event_reference: 1 }, { sparse: true });

module.exports = mongoose.model('vendor_compliance_provider_verifications', mSchema);
