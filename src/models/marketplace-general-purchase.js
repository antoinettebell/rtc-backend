const crypto = require('crypto');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const itemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true, maxlength: 200 },
  quantity: { type: Number, required: true, min: 0.01 },
  unit_price: { type: Number, required: true, min: 0 },
  line_total: { type: Number, required: true, min: 0 },
}, { _id: false });

const schema = new mongoose.Schema({
  purchase_id: { type: String, default: uuidv4, unique: true, index: true },
  event_vendor_profile_id: { type: String, required: true, index: true },
  vendor_user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },
  checkout_key: { type: String, required: true, immutable: true },
  reference: {
    type: String,
    unique: true,
    immutable: true,
    default: () => `M${crypto.randomBytes(4).toString('hex').slice(0, 7)}`,
  },
  transaction_type: { type: String, enum: ['MARKETPLACE_VENDOR_GENERAL_PURCHASE'], default: 'MARKETPLACE_VENDOR_GENERAL_PURCHASE' },
  items: { type: [itemSchema], required: true },
  subtotal: { type: Number, required: true, min: 0 },
  tax_rate: { type: Number, required: true, min: 0, max: 25 },
  tax_amount: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'USD', uppercase: true },
  customer_phone: { type: String, default: null },
  status: {
    type: String,
    enum: ['PREPARED', 'PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED', 'CANCELED', 'REFUND_PROCESSING', 'REFUNDED', 'REFUND_FAILED'],
    default: 'PREPARED',
    index: true,
  },
  transaction_id: { type: String, default: null },
  auth_code: { type: String, default: null },
  invoice_number: { type: String, default: null },
  account_number: { type: String, default: null },
  account_type: { type: String, default: null },
  completed_at: { type: Date, default: null },
  canceled_at: { type: Date, default: null },
  refund_transaction_id: { type: String, default: null },
  refund_mode: { type: String, enum: ['void', 'refund'], default: null },
  refunded_at: { type: Date, default: null },
  refund_failure_reason: { type: String, default: null },
}, { timestamps: true });

schema.index({ vendor_user_id: 1, checkout_key: 1 }, { unique: true });
schema.index(
  { transaction_id: 1 },
  { unique: true, partialFilterExpression: { transaction_id: { $type: 'string' } } }
);
module.exports = mongoose.model('marketplace-general-purchases', schema);
