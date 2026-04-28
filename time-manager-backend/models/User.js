const mongoose = require("mongoose");
const { Schema } = mongoose;

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  friends: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  incomingRequests: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  outgoingRequests: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  friendMeta: { type: Schema.Types.Mixed, default: {} },
  role: { type: String, enum: ["user", "admin"], default: "user" }
}, {
  timestamps: true
});

userSchema.index({ email: 1 }, { unique: true });

function publicUser(user) {
  if (!user) return null;
  const obj = typeof user.toObject === "function" ? user.toObject() : user;
  return {
    id: String(obj._id || obj.id),
    name: obj.name || "",
    email: obj.email || "",
    friends: Array.isArray(obj.friends) ? obj.friends.map(String) : [],
    incomingRequests: Array.isArray(obj.incomingRequests) ? obj.incomingRequests.map(String) : [],
    outgoingRequests: Array.isArray(obj.outgoingRequests) ? obj.outgoingRequests.map(String) : [],
    friendMeta: typeof obj.friendMeta === "object" && obj.friendMeta ? obj.friendMeta : {},
    role: obj.role || "user",
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

const User = mongoose.model("User", userSchema);

module.exports = {
  User,
  publicUser
};
