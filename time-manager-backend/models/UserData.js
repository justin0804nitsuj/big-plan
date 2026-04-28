const mongoose = require("mongoose");
const { Schema } = mongoose;

const userDataSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  tasks: { type: [Schema.Types.Mixed], default: [] },
  pomodoroHistory: { type: [Schema.Types.Mixed], default: [] },
  focusSessions: { type: [Schema.Types.Mixed], default: [] },
  distractions: { type: [Schema.Types.Mixed], default: [] },
  settings: { type: Schema.Types.Mixed, default: {} },
  dailyStats: { type: Schema.Types.Mixed, default: {} },
  learningProgress: { type: Schema.Types.Mixed, default: {} },
  aiLogs: { type: [Schema.Types.Mixed], default: [] }
}, {
  timestamps: true
});

const UserData = mongoose.model("UserData", userDataSchema);
module.exports = UserData;
