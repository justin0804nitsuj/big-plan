const mongoose = require("mongoose");
const { Schema } = mongoose;

const groupSchema = new Schema({
  name: { type: String, required: true, maxlength: 40, trim: true },
  description: { type: String, default: "", maxlength: 200, trim: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  memberIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }]
}, {
  timestamps: true
});

const Group = mongoose.model("Group", groupSchema);
module.exports = Group;
