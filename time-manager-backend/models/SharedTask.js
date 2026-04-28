const mongoose = require("mongoose");
const { Schema } = mongoose;

const sharedTaskSchema = new Schema({
  fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  taskSnapshot: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" }
}, {
  timestamps: true
});

const SharedTask = mongoose.model("SharedTask", sharedTaskSchema);
module.exports = SharedTask;
