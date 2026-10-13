const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Coordinator W-9 sessions are intentionally separate from food-truck
// compliance. The same DocuSign template is used, but a coordinator's signed
// tax document must never be treated as a vendor compliance document.
const mSchema = mongoose.Schema({
  session_id: { type: String, default: uuidv4, unique: true, index: true },
  coordinator_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
  },
  envelope_id: { type: String, required: true, unique: true, index: true },
  status: {
    type: String,
    enum: ['SENT', 'SIGNED', 'DECLINED', 'VOIDED', 'ERROR'],
    default: 'SENT',
    index: true,
  },
  signed_document_url: { type: String, default: null },
  signed_document_key: { type: String, default: null },
  verification_status: {
    type: String,
    enum: ['NOT_STARTED', 'PENDING', 'REVALIDATION_NEEDED', 'MANUAL_REVIEW', 'PASSED', 'FAILED'],
    default: 'NOT_STARTED',
    index: true,
  },
  completed_at: { type: Date, default: null },
  error_message: { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('coordinator_compliance_w9_envelopes', mSchema);
