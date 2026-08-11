const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const photoSnapshotSchema = new mongoose.Schema({
  photo_id: String,
  file_url: String,
  file_key: String,
  category: String,
  source: String,
  original_name: String,
  mime_type: String,
}, { _id: false });

const schema = mongoose.Schema({
  application_id: { type: String, default: uuidv4, unique: true },
  event_id: { type: String, required: true, index: true },
  profile_id: { type: String, required: true, index: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  vendor_types: [{ type: String, enum: ['MERCHANDISE', 'SERVICE', 'OTHER'] }],
  participation_path: { type: String, enum: ['BID', 'APPLICATION'], default: null, index: true },
  business_name: { type: String, required: true },
  contact_name: { type: String, required: true },
  contact_number: { type: String, required: true },
  offering_bullets: { type: [String], required: true, validate: [(value) => value.length > 0, 'At least one offering is required'] },
  average_price: { type: Number, required: true, min: 0 },
  additional_notes: { type: String, default: null, maxlength: 300 },
  photos: { type: [photoSnapshotSchema], default: [], validate: [(value) => value.length <= 5, 'Up to 5 photos are allowed'] },
  electricity_required: { type: Boolean, required: true },
  electricity_fee: { type: Number, min: 0, default: 0 },
  electricity_fee_acknowledged: { type: Boolean, default: false },
  category_fee: { type: Number, min: 0, required: true },
  checkout_subtotal: { type: Number, min: 0, required: true },
  checkout_fee_rate: { type: Number, default: 3.5 },
  nda_version: { type: String, required: true },
  nda_accepted_at: { type: Date, required: true },
  governance_version: { type: String, required: true },
  governance_accepted_at: { type: Date, required: true },
  accepted_ip: { type: String, default: null },
  status: { type: String, enum: ['SUBMITTED', 'UNDER_REVIEW', 'AWARDED', 'NOT_SELECTED', 'PAYMENT_DUE', 'PAID', 'WITHDRAWN'], default: 'SUBMITTED', index: true },
  withdrawn_at: { type: Date, default: null },
  payment_id: { type: String, default: null, index: true },
  coordinator_details_email_status: { type: String, enum: ['PENDING', 'SENDING', 'SENT', 'RETRYABLE'], default: 'PENDING', index: true },
  coordinator_details_email_sent_at: { type: Date, default: null },
  coordinator_details_email_claimed_at: { type: Date, default: null },
  coordinator_details_email_claim_token: { type: String, default: null, index: true },
  coordinator_details_email_last_error: { type: String, default: null, maxlength: 500 },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

schema.index({ event_id: 1, vendor_user_id: 1 }, { unique: true });
module.exports = mongoose.model('event-vendor-applications', schema);
