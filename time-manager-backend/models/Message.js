const mongoose = require("mongoose");
const { Schema } = mongoose;

const messageSchema = new Schema({
  roomId: { type: String, index: true, required: true },
  senderId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  receiverId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  groupId: { type: Schema.Types.ObjectId, ref: "Group", default: null },
  type: { type: String, enum: ["text", "image", "quick"], default: "text" },
  content: { type: String, default: "" },
  imageUrl: { type: String, default: "" },
  deletedFor: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  recalledAt: { type: Date, default: null }
}, {
  timestamps: true
});

messageSchema.index({ roomId: 1 });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;
