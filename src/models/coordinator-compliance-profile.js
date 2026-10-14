const mongoose = require('mongoose');

// Identity and evidence for an event coordinator deliberately live outside the
// customer profile.  In particular, a driver license is retained by RTC and is
// never supplied to an identity provider.
const documentSchema = new mongoose.Schema({
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
