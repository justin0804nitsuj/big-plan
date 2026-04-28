const mongoose = require("mongoose");
const { Schema } = mongoose;

const threadSchema = new Schema({
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, required: true, maxlength: 80, trim: true },
  content: { type: String, required: true, maxlength: 3000, trim: true },
  subject: { type: String, default: "", trim: true },
  tags: { type: [String], default: [] },
  imageUrls: { type: [String], default: [] },
  status: { type: String, enum: ["open", "solved"], default: "open" },
  acceptedReplyId: { type: Schema.Types.ObjectId, ref: "ThreadReply", default: null }
}, {
  timestamps: true
});

const Thread = mongoose.model("Thread", threadSchema);
module.exports = Thread;
