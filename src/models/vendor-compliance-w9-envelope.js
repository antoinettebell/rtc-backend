const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema({
  session_id: { type: String, default: uuidv4, unique: true, index: true },
  food_truck_id: { type: mongoose.Schema.Types.ObjectId, ref: 'food-trucks', required: true, index: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  envelope_id: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['SENT', 'SIGNED', 'DECLINED', 'VOIDED', 'ERROR'], default: 'SENT', index: true },
  compliance_document_id: { type: String, default: null },
  completed_at: { type: Date, default: null },
  error_message: { type: String, default: null },
  // A completed legal-payee record is retained as historical evidence when
  // the vendor deliberately replaces its account type. Archived sessions
  // can never be used to recreate the old W-9 compliance document.
  archived_at: { type: Date, default: null, index: true },
  archived_reason: { type: String, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('vendor_compliance_w9_envelopes', mSchema);
