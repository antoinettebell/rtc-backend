const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = mongoose.Schema({
  profile_id: { type: String, default: uuidv4, unique: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, unique: true },
  vendor_types: [{ type: String, enum: ['MERCHANDISE', 'SERVICE', 'OTHER'] }],
  business_name: { type: String, required: true, trim: true, maxlength: 150 },
  business_description: { type: String, required: true, trim: true, maxlength: 300 },
  social_links: { type: [String], default: [], validate: [(value) => value.length <= 2, 'Up to 2 links are allowed'] },
  merchandise_categories: [{
    type: String,
    enum: ['ARTISANS_CRAFTERS', 'APPAREL_ACCESSORIES', 'COMMERCIAL_RETAIL', 'LOCAL_MAKERS_SPECIALTY'],
  }],
  logo_url: { type: String, default: null },
  logo_key: { type: String, default: null },
  review_status: {
    type: String,
    enum: ['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED'],
    default: 'DRAFT',
    index: true,
  },
  submitted_at: { type: Date, default: null },
  submission_count: { type: Number, default: 0, min: 0 },
  reviewed_at: { type: Date, default: null },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
  rejection_reason: { type: String, default: null, maxlength: 1000 },
  review_history: [{
    status: { type: String, enum: ['PENDING_REVIEW', 'APPROVED', 'REJECTED'] },
    reason: { type: String, default: null },
    changed_at: { type: Date, default: Date.now },
    changed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'users', default: null },
  }],
  repository_photo_total: { type: Number, default: 0, min: 0 },
  repository_photo_counts: {
    ARTISANS_CRAFTERS: { type: Number, default: 0, min: 0 },
    APPAREL_ACCESSORIES: { type: Number, default: 0, min: 0 },
    COMMERCIAL_RETAIL: { type: Number, default: 0, min: 0 },
    LOCAL_MAKERS_SPECIALTY: { type: Number, default: 0, min: 0 },
  },
  repository_counter_state: { type: String, enum: ['PENDING', 'RUNNING', 'COMPLETE'], default: 'PENDING' },
  repository_counter_reconciled_at: { type: Date, default: null },
  status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('event-vendor-profiles', schema);
