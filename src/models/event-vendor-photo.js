const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = mongoose.Schema({
  photo_id: { type: String, default: uuidv4, unique: true },
  profile_id: { type: String, required: true, index: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  file_url: { type: String, required: true },
  file_key: { type: String, required: true },
  original_name: { type: String, default: null },
  mime_type: { type: String, default: null },
  status: { type: String, enum: ['ACTIVE', 'ARCHIVED'], default: 'ACTIVE', index: true },
  archived_at: { type: Date, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

schema.index({ vendor_user_id: 1, status: 1 });
module.exports = mongoose.model('event-vendor-photos', schema);
