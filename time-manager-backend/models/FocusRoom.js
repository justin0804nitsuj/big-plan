const mongoose = require("mongoose");
const { Schema } = mongoose;

const focusRoomSchema = new Schema({
  hostId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  participantIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  invitedUserIds: [{ type: Schema.Types.ObjectId, ref: "User", default: [] }],
  status: { type: String, enum: ["waiting", "running", "paused", "ended"], default: "waiting" },
  durationMinutes: { type: Number, default: 25 },
  startedAt: { type: Date, default: null },
  pausedRemainingSeconds: { type: Number, default: null },
  endedAt: { type: Date, default: null }
}, {
  timestamps: true
});

const FocusRoom = mongoose.model("FocusRoom", focusRoomSchema);
module.exports = FocusRoom;
