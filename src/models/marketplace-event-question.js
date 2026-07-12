const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const mSchema = mongoose.Schema(
  {
    question_id: {
      type: String,
      default: uuidv4,
      unique: true,
    },
    event_id: {
      type: String,
      required: true,
      index: true,
    },
    vendor_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    food_truck_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'food-trucks',
      required: true,
      index: true,
    },
    vendor_display_id: {
      type: String,
      required: true,
    },
    question_text_raw: {
      type: String,
      required: true,
    },
    question_text_public: {
      type: String,
      default: null,
    },
    answer_text_raw: {
      type: String,
      default: null,
    },
    answer_text_public: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PUBLISHED', 'BLOCKED', 'ARCHIVED'],
      default: 'PENDING',
      index: true,
    },
    question_moderation_status: {
      type: String,
      enum: ['CLEAN', 'BLOCKED'],
      default: 'CLEAN',
    },
    answer_moderation_status: {
      type: String,
      enum: ['CLEAN', 'BLOCKED'],
      default: 'CLEAN',
    },
    question_moderation_reasons: {
      type: [String],
      default: [],
    },
    answer_moderation_reasons: {
      type: [String],
      default: [],
    },
    answered_by_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
      index: true,
    },
    answered_by_role: {
      type: String,
      enum: ['CUSTOMER', 'SUPER_ADMIN', null],
      default: null,
    },
    acted_by_admin_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    acted_on_behalf_of_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      default: null,
    },
    proxy_action_reason: {
      type: String,
      default: null,
    },
    answered_at: {
      type: Date,
      default: null,
    },
    coordinator_read_at: {
      type: Date,
      default: null,
      index: true,
    },
    vendor_read_at: {
      type: Date,
      default: null,
      index: true,
    },
    archived_at: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: {
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  }
);

mSchema.index({ event_id: 1, status: 1, created_at: -1 });

module.exports = new mongoose.model('marketplace-event-questions', mSchema);
