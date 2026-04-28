const mongoose = require("mongoose");
const { Schema } = mongoose;

const threadReplySchema = new Schema({
  threadId: { type: Schema.Types.ObjectId, ref: "Thread", required: true, index: true },
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  content: { type: String, required: true, maxlength: 3000, trim: true },
  imageUrls: { type: [String], default: [] }
}, {
  timestamps: true
});

const ThreadReply = mongoose.model("ThreadReply", threadReplySchema);
module.exports = ThreadReply;
