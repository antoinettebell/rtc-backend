const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

// Identity and evidence for an event coordinator deliberately live outside the
// customer profile.  In particular, a driver license is retained by RTC and is
// never supplied to an identity provider.
const documentSchema = new mongoose.Schema({
  document_id: { type: String, default: uuidv4, index: true },
  document_type: {
    type: String,
    enum: ['DRIVER_LICENSE_FRONT', 'BUSINESS_LICENSE'],
    required: true,
  },
  file_url: { type: String, required: true },
  file_key: { type: String, required: true },
  original_name: { type: String, default: null },
  mime_type: { type: String, default: null },
  uploaded_at: { type: Date, default: Date.now },
  ocr_status: {
    type: String,
    enum: ['not_configured', 'queued', 'processing', 'completed', 'failed', 'manual_review', 'revalidation_needed'],
    default: 'not_configured',
  },
  review_status: {
    type: String,
    enum: ['pending_review', 'verified', 'manual_review', 'revalidation_needed'],
    default: 'pending_review',
  },
  ocr_requested_at: { type: Date, default: null },
  ocr_completed_at: { type: Date, default: null },
  ocr_error_message: { type: String, default: null },
  extracted_fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Values from the isolated coordinator compliance form that were compared
  // during the most recent OCR submission. This lets later form corrections
  // requeue existing evidence without relying on a new file upload.
  ocr_comparison_snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const schema = new mongoose.Schema({
  coordinator_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    unique: true,
    required: true,
    index: true,
  },
  party_type: { type: String, enum: ['INDIVIDUAL', 'BUSINESS'], default: null },
  legal_name: { type: String, default: null },
  dba_name: { type: String, default: null },
  entity_type: {
    type: String,
    enum: ['SOLE_PROPRIETOR', 'LLC', 'CORPORATION', 'PARTNERSHIP', 'S_CORPORATION', null],
    default: null,
  },
  registration_state: { type: String, default: null },
  business_address: { type: String, default: null },
  tax_id_type: { type: String, enum: ['EIN', 'SSN', null], default: null },
  tax_id_encrypted: { type: String, default: null },
  tax_id_masked: { type: String, default: null },
  documents: { type: [documentSchema], default: [] },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('coordinator_compliance_profiles', schema);
