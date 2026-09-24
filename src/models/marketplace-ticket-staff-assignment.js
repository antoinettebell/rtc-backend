const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = new mongoose.Schema({
  assignment_id: { type: String, default: uuidv4, unique: true, index: true },
  event_id: { type: String, required: true, index: true },
  coordinator_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  staff_customer_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  status: { type: String, enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED'], default: 'PENDING', index: true },
  invited_at: { type: Date, default: Date.now },
  responded_at: { type: Date, default: null },
  revoked_at: { type: Date, default: null },
  expires_at: { type: Date, required: true, index: true },
  reminder_sent_at: { type: Date, default: null },
  action_source: { type: String, enum: ['COORDINATOR', 'INVITEE', 'ADMIN', 'SYSTEM'], default: 'COORDINATOR' },
}, { timestamps: true });

schema.index({ event_id: 1, staff_customer_user_id: 1 }, { unique: true });
module.exports = mongoose.model('marketplace-ticket-staff-assignments', schema);
