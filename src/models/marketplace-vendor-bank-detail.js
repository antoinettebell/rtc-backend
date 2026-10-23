const mongoose = require('mongoose');

// Marketplace Vendor payout details are deliberately isolated from Food Vendor
// bank-details. Values are encrypted by the controller before persistence.
const schema = mongoose.Schema(
  {
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      unique: true,
      index: true,
    },
    marketplace_vendor_profile_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    accountHolderName: { type: String, default: '' },
    walletPaymentHandle: { type: String, default: '' },
    bankName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    accountType: { type: String, enum: ['CHECKING', 'SAVINGS', ''], default: '' },
    paymentMethod: {
      type: String,
      enum: ['CASHAPP', 'PAYPAL', 'VENMO', 'ACH', 'CHECK'],
      default: 'ACH',
      required: true,
    },
    paymentQrCodeUrl: { type: String, default: '' },
    remittanceEmail: { type: String, default: '' },
    currency: { type: String, default: '' },
    swiftCode: { type: String, default: '' },
    iban: { type: String, default: '' },
    bankAddressLine1: { type: String, default: 'NA' },
    bankAddressLine2: { type: String, default: '' },
    bankCity: { type: String, default: 'NA' },
    bankState: { type: String, default: 'NA' },
    bankPostal: { type: String, default: 'NA' },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } },
);

module.exports = mongoose.model('marketplace-vendor-bank-details', schema);
