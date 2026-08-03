const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = mongoose.Schema({
  profile_id: { type: String, default: uuidv4, unique: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, unique: true },
  vendor_types: [{ type: String, enum: ['MERCHANDISE', 'SERVICE', 'OTHER'] }],
  business_name: { type: String, required: true, trim: true, maxlength: 150 },
  business_description: { type: String, required: true, trim: true, maxlength: 300 },
  social_links: { type: [String], default: [], validate: [(value) => value.length <= 2, 'Up to 2 links are allowed'] },
  logo_url: { type: String, default: null },
  logo_key: { type: String, default: null },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('event-vendor-profiles', schema);
