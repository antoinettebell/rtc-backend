const mongoose = require('mongoose');

const validationErrorSchema = new mongoose.Schema({
  field: { type: String, required: true },
  message: { type: String, required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  draft_key: { type: String, required: true, unique: true, index: true },
  draft_type: { type: String, enum: ['EVENT', 'SUBMISSION'], required: true, index: true },
  event_id: { type: String, required: true, index: true },
  submission_type: { type: String, default: null, index: true },
  submission_id: { type: String, default: null, index: true },
  admin_user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'users',
    required: true,
    index: true,
  },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  reason: { type: String, default: null },
  validation_errors: { type: [validationErrorSchema], default: [] },
}, { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } });

module.exports = mongoose.model('marketplace-admin-drafts', schema);
