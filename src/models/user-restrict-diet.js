/**
 * Mongoose model for user-restrict-diet collection
 */
const mongoose = require("mongoose");

const mSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    diet: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "diets",
      },
    ],
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("user-restrict-diet", mSchema);
