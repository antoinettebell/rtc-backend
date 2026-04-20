/**
 * Mongoose model for order collection
 */
const mongoose = require('mongoose');

/**
 * Model schema
 *
 * @type {*}
 */
const mSchema = mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: false,
    },
    orderId: {  
      type: mongoose.Schema.Types.ObjectId,
      ref: 'orders',
      default: null,
      required: false,
    },
    invoiceNumber:{
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: false,
      default: 0,
    },
    mode: {
      type: String,
      default: null,
    },
     level: {
      type: String,
      default: null,
    },
    
    type: {
      type: String,
      enum: ['CHECKOUT', 'REFUND', 'VOID', 'NONE'],
    },
    requestPayload: {
      type: Object,
      default: {},
    },
    // Raw gateway response from Authorize.net
    responsePayload: {
      type: Object,
      default: {},
    },
    transactionId: {
      type: String,
      default: null,
    },
     paymentMethod:{
      type: String,
      default: null,
    },
    authCode: {
      type: String,
      default: null,
    },
    uniqueId: {
      type: String,
      default: null,
    },
    success: { type: Boolean, default: false },
    orderpaymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
    },
    response_type: {
      type: String,
      default: null,
    },
     accountNumber: {
      type: String,
      default: null,
    },
     accountType: {
      type: String,
      default: null,
    },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('payment-logs', mSchema);
