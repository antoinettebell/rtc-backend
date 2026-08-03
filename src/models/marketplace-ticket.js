const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    ticket_id: { type: String, default: uuidv4, unique: true },
    ticket_order_id: { type: String, required: true, index: true },
    event_id: { type: String, required: true, index: true },
    customer_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    ticket_type: { type: String, enum: ['GA', 'VIP'], required: true },
    attendee_label: { type: String, required: true },
    token_hash: { type: String, required: true, unique: true, select: false },
    token_encrypted: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ['ACTIVE', 'CHECKED_IN', 'REFUNDED', 'VOIDED', 'EVENT_CANCELLED'],
      default: 'ACTIVE',
      index: true,
    },
    checked_in_at: { type: Date, default: null, index: true },
    checked_in_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    checked_in_session_id: { type: String, default: null },
    delivered_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

mSchema.index({ event_id: 1, status: 1 });
mSchema.index({ ticket_order_id: 1, ticket_type: 1 });

module.exports = mongoose.model('marketplace-tickets', mSchema);
