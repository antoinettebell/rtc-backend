const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    audit_id: {
      type: String,
      default: uuidv4,
      unique: true,
      index: true,
    },
    document_id: {
      type: String,
      default: null,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food_trucks',
      required: true,
      index: true,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    actor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    actor_user_type: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

module.exports = new mongoose.model('vendor_compliance_audits', mSchema);
