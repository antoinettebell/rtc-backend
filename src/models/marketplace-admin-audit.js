const mongoose = require('mongoose');

const schema = mongoose.Schema({
  action: { type: String, required: true, index: true },
  event_id: { type: String, required: true, index: true },
  submission_type: { type: String, default: null, index: true },
  submission_id: { type: String, default: null, index: true },
  admin_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
  },
  reason: { type: String, default: null },
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('marketplace-admin-audits', schema);
