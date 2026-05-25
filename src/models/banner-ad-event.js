const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    banner_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'banners',
      required: true,
      index: true,
    },
    ad_vendor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'banners',
      required: true,
      index: true,
    },
    event_type: {
      type: String,
      enum: ['IMPRESSION', 'CLICK'],
      required: true,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = new mongoose.model('banner-ad-events', mSchema);
