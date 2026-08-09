const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  object_key: { type: String, required: true, unique: true, index: true },
  reason: { type: String, required: true },
  protect_application_snapshots: { type: Boolean, default: true },
  status: { type: String, enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'PROTECTED'], default: 'PENDING', index: true },
  attempts: { type: Number, default: 0 },
  next_attempt_at: { type: Date, default: Date.now, index: true },
  lease_until: { type: Date, default: null, index: true },
  completed_at: { type: Date, default: null },
  last_error: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('event-vendor-object-cleanups', schema);
