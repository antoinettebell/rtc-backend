const mongoose = require('mongoose');

const mSchema = mongoose.Schema(
  {
    session_token_hash: { type: String, required: true, unique: true, select: false },
    event_id: { type: String, required: true, index: true },
    coordinator_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'users',
      required: true,
      index: true,
    },
    expires_at: { type: Date, required: true, index: { expires: 0 } },
    revoked_at: { type: Date, default: null, index: true },
    last_used_at: { type: Date, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('marketplace-scanner-sessions', mSchema);
