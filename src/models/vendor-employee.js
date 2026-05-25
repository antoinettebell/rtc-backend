/**
 * Mongoose model for vendor employee collection
 */
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const mongoose = require('mongoose');

const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$/;

const formatEmployeeLoginId = ({ first_name, last_name, zip_code }) => {
  const firstInitial = String(first_name || '').trim().charAt(0);
  const normalizedLastName = String(last_name || '')
    .trim()
    .replace(/[^a-z0-9]/gi, '');
  const normalizedZip = String(zip_code || '')
    .trim()
    .replace(/[^a-z0-9]/gi, '');

  return `${firstInitial}${normalizedLastName}${normalizedZip}`.toLowerCase();
};

const mSchema = mongoose.Schema(
  {
    employee_internal_id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => `EMP-${crypto.randomUUID()}`,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      immutable: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      immutable: true,
      index: true,
    },
    assigned_location_id: {
      type: String,
      required: true,
      index: true,
    },
    first_name: {
      type: String,
      required: true,
      trim: true,
    },
    last_name: {
      type: String,
      required: true,
      trim: true,
    },
    zip_code: {
      type: String,
      required: true,
      trim: true,
    },
    employee_login_id: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      immutable: true,
      index: true,
      default: function () {
        return formatEmployeeLoginId(this);
      },
    },
    pin_hash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['EMPLOYEE'],
      default: 'EMPLOYEE',
      immutable: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    is_working: {
      type: Boolean,
      default: false,
    },
    is_archived: {
      type: Boolean,
      default: false,
    },
    last_login_at: {
      type: Date,
      default: null,
    },
  },
  {
    collection: 'vendor_employees',
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

mSchema.index({ food_truck_id: 1, employee_login_id: 1 }, { unique: true });
mSchema.index({ vendor_user_id: 1, is_active: 1, is_archived: 1 });

mSchema.pre('validate', function () {
  if (!this.employee_login_id) {
    this.employee_login_id = formatEmployeeLoginId(this);
  }
});

mSchema.pre('save', async function () {
  if (this.isModified('pin_hash') && !BCRYPT_PATTERN.test(this.pin_hash)) {
    this.pin_hash = await bcrypt.hash(this.pin_hash, 12);
  }
});

mSchema.methods.comparePin = async function (pin) {
  return bcrypt.compare(String(pin || ''), this.pin_hash);
};

mSchema.statics.formatEmployeeLoginId = formatEmployeeLoginId;

module.exports = mongoose.model('vendor-employees', mSchema);
