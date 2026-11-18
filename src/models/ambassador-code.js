const mongoose = require('mongoose');

const ambassadorCodeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 40,
    },
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    phoneNumber: { type: String, required: true, trim: true, maxlength: 30 },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'ambassador-codes' }
);

ambassadorCodeSchema.index({ code: 1 }, { unique: true });

module.exports = mongoose.model('ambassador-codes', ambassadorCodeSchema);
