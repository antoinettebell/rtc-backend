const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const schema = new mongoose.Schema(
  {
    notification_id: { type: String, default: uuidv4, unique: true },
    notification_key: { type: String, required: true, unique: true, index: true },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    event_id: { type: String, required: true, index: true },
    bid_id: { type: String, default: null, index: true },
    amendment_id: { type: String, default: null, index: true },
    type: {
      type: String,
      enum: ['MARKETPLACE_EVENT_UPDATED', 'MARKETPLACE_AWARD_AMENDMENT'],
      required: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, default: null, maxlength: 80 },
    action_required: { type: Boolean, default: false },
    occurred_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

schema.index({ vendor_user_id: 1, occurred_at: -1 });

module.exports = mongoose.model('marketplace_vendor_notifications', schema);
