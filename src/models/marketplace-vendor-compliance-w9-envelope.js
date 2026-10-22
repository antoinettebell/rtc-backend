const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = new mongoose.Schema({
  session_id: { type: String, default: uuidv4, unique: true, index: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  marketplace_vendor_profile_id: { type: String, required: true, index: true },
  envelope_id: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['SENT', 'SIGNED', 'DECLINED', 'VOIDED', 'ERROR'], default: 'SENT', index: true },
  signed_document_url: { type: String, default: null },
  signed_document_key: { type: String, default: null },
  verification_status: { type: String, enum: ['NOT_STARTED', 'PENDING', 'REVALIDATION_NEEDED', 'MANUAL_REVIEW', 'PASSED', 'FAILED'], default: 'NOT_STARTED', index: true },
  ocr_document_id: { type: String, default: uuidv4, unique: true, sparse: true, index: true },
  ocr_status: { type: String, enum: ['not_configured', 'queued', 'processing', 'completed', 'failed', 'manual_review', 'revalidation_needed'], default: 'not_configured' },
  ocr_requested_at: { type: Date, default: null }, ocr_completed_at: { type: Date, default: null }, ocr_error_message: { type: String, default: null },
  extracted_fields: { type: mongoose.Schema.Types.Mixed, default: {} }, ocr_comparison_snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  ocr_comparison_rule_version: { type: Number, default: null }, revalidation_attempt: { type: Number, default: 0, min: 0 }, completed_at: { type: Date, default: null }, error_message: { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

schema.index({ vendor_user_id: 1, marketplace_vendor_profile_id: 1, created_at: -1 });
module.exports = mongoose.model('marketplace_vendor_compliance_w9_envelopes', schema);
