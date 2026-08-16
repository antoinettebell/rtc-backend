const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    ticket_order_id: { type: String, default: uuidv4, unique: true },
    event_id: { type: String, required: true, index: true },
    customer_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
      index: true,
    },
    idempotency_key: { type: String, required: true },
    purchaser_name: { type: String, required: true },
    purchaser_email: { type: String, required: true, lowercase: true },
    purchaser_phone: { type: String, required: true },
    ga_quantity: { type: Number, min: 0, default: 0 },
    vip_quantity: { type: Number, min: 0, default: 0 },
    ticket_subtotal: { type: Number, min: 0, required: true },
    customer_processing_fee: { type: Number, min: 0, required: true },
    coordinator_processing_fee: { type: Number, min: 0, required: true },
    sales_tax: { type: Number, min: 0, default: 0 },
    total_amount: { type: Number, min: 0, required: true },
    net_coordinator_payout: { type: Number, required: true },
    avalara_transaction_code: { type: String, default: null, index: true },
    avalara_entity_use_code: { type: String, enum: ['E', 'F', null], default: null },
    payment_method: {
      type: String,
      enum: ['APPLE_PAY', 'GOOGLE_PAY'],
      required: true,
    },
    gateway_transaction_id: { type: String, default: null, index: true },
    refund_transaction_id: { type: String, default: null, index: true },
    status: {
      type: String,
      enum: [
        'RESERVED',
        'PAYMENT_PROCESSING',
        'PAID',
        'PAYMENT_FAILED',
        'EXPIRED',
        'REFUND_PENDING',
        'REFUNDED',
        'REFUND_FAILED',
        'CANCELLED',
      ],
      default: 'RESERVED',
      index: true,
    },
    reservation_expires_at: { type: Date, required: true, index: true },
    paid_at: { type: Date, default: null },
    refunded_at: { type: Date, default: null },
    failure_reason: { type: String, default: null },
    refund_failure_reason: { type: String, default: null },
    ticket_delivery_sent_at: { type: Date, default: null },
    ticket_sms_status: { type: String, enum: ['PENDING', 'SENT', 'SKIPPED', 'FAILED'], default: 'PENDING' },
    ticket_email_status: { type: String, enum: ['PENDING', 'SENT', 'FAILED'], default: 'PENDING' },
    ticket_sms_failure_reason: { type: String, default: null },
    ticket_email_failure_reason: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

mSchema.index({ event_id: 1, status: 1 });
mSchema.index({ customer_user_id: 1, idempotency_key: 1 }, { unique: true });
mSchema.index({ status: 1, reservation_expires_at: 1 });

module.exports = mongoose.model('marketplace-ticket-orders', mSchema);
