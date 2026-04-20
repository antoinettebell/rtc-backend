/**
 * Mongoose model for bank-detail collection
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
      required: true,
    },
    accountHolderName: {
      type: String,
      required: true,
    },
    bankName: {
      type: String,
      required: true,
    },
    accountNumber: {
      type: String,
      required: true,
    },
    routingNumber: {
      type: String,
      required: true,
    },
    accountType: {
      type: String,
      enum: ['CHECKING', 'SAVINGS'],
      required: true,
    },
    paymentMethod: {
      type: String,
      enum: ['ACH', 'CHECK', 'ECHECK', 'PAYPAL', 'WIRE'],
      default: 'ACH',
      required: true,
    },
    remittanceEmail: {
      type: String,
      required: false,
    },
    currency: {
      type: String,
      required: false,
    },
    swiftCode: {
      type: String,
      required: false,
    },
    iban: {
      type: String,
      required: false,
    },
    bankAddressLine1: {
      type: String,
      default: 'NA',
    },
    bankAddressLine2: {
      type: String,
      default: '',
    },
    bankCity: {
      type: String,
      default: 'NA',
    },
    bankState: {
      type: String,
      default: 'NA',
    },
    bankPostal: {
      type: String,
      default: 'NA',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('bank-details', mSchema);
