const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Marketplace Vendor identity and evidence are isolated from both food-vendor
// and Event Coordinator compliance. Tax identifiers remain encrypted by the
// controller; this model deliberately never stores a plaintext federal ID.
const documentSchema = new mongoose.Schema({
  document_id: { type: String, default: uuidv4, index: true },
  document_type: { type: String, enum: ['DRIVER_LICENSE_FRONT', 'BUSINESS_LICENSE'], required: true },
  file_url: { type: String, required: true },
  file_key: { type: String, required: true },
  original_name: { type: String, default: null },
  mime_type: { type: String, default: null },
  uploaded_at: { type: Date, default: Date.now },
  ocr_status: { type: String, enum: ['not_configured', 'queued', 'processing', 'completed', 'failed', 'manual_review', 'revalidation_needed'], default: 'not_configured' },
  review_status: { type: String, enum: ['pending_review', 'verified', 'manual_review', 'revalidation_needed'], default: 'pending_review' },
  ocr_requested_at: { type: Date, default: null },
  ocr_completed_at: { type: Date, default: null },
  ocr_error_message: { type: String, default: null },
  extracted_fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  ocr_comparison_snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  ocr_comparison_rule_version: { type: Number, default: null },
  // Retained only when a fully compliant legal payee is deliberately replaced.
  // Archived evidence is excluded from all active compliance calculations.
  archived_at: { type: Date, default: null, index: true },
  archived_reason: { type: String, default: null },
}, { _id: false });

const schema = new mongoose.Schema({
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, unique: true, index: true },
  marketplace_vendor_profile_id: { type: String, required: true, unique: true, index: true },
  party_type: { type: String, enum: ['INDIVIDUAL', 'BUSINESS'], default: null },
  legal_name: { type: String, default: null },
  dba_name: { type: String, default: null },
  entity_type: { type: String, enum: ['SOLE_PROPRIETOR', 'LLC', 'CORPORATION', 'PARTNERSHIP', 'S_CORPORATION', null], default: null },
  registration_state: { type: String, default: null },
  business_address: { type: String, default: null },
  // Structured legal-payee mailing address. This is isolated from the user
  // profile so Marketplace compliance never depends on profile data.
  mailing_address_line1: { type: String, default: null },
  mailing_address_line2: { type: String, default: null },
  mailing_city: { type: String, default: null },
  mailing_state: { type: String, default: null },
  mailing_postal: { type: String, default: null },
  mailing_country: { type: String, default: 'US' },
  tax_id_type: { type: String, enum: ['EIN', 'SSN', null], default: null },
  tax_id_encrypted: { type: String, default: null },
  tax_id_masked: { type: String, default: null },
  external_verification_cycle: { type: Number, default: 1, min: 1 },
  documents: { type: [documentSchema], default: [] },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('marketplace_vendor_compliance_profiles', schema);
