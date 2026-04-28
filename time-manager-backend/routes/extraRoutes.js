const express = require("express");
const mongoose = require("mongoose");
const { User, publicUser } = require("../models/User");
const UserData = require("../models/UserData");
const SharedTask = require("../models/SharedTask");
const FocusRoom = require("../models/FocusRoom");

const router = express.Router();

function getIo(req) {
  return req.app.get("io");
}

function emitPrivateEvent(io, userId, event, payload) {
  if (!io || !userId || !event) return;
  io.to(`user_${userId}`).emit(event, payload);
}

function emitToUsers(io, userIds, event, payload) {
  if (!io) return;
  Array.from(new Set(userIds.filter(Boolean).map(String))).forEach((userId) => {
    emitPrivateEvent(io, userId, event, payload);
  });
}

function createTaskId() {
  return `t_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function normalizeFocusRoom(room) {
  if (!room) return null;
  const obj = typeof room.toObject === "function" ? room.toObject() : room;
  return {
    ...obj,
    id: String(obj._id || obj.id),
    hostId: obj.hostId ? String(obj.hostId) : null,
    participantIds: Array.isArray(obj.participantIds) ? obj.participantIds.map(String) : [],
    invitedUserIds: Array.isArray(obj.invitedUserIds) ? obj.invitedUserIds.map(String) : [],
    durationMinutes: obj.durationMinutes,
    startedAt: obj.startedAt,
    pausedRemainingSeconds: obj.pausedRemainingSeconds,
    endedAt: obj.endedAt,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

function roomRemainingSeconds(room) {
  if (!room) return 0;
  const totalSeconds = Math.max(1, Number(room.durationMinutes) || 25) * 60;
  if (room.status === "running" && room.startedAt) {
    const startedAt = new Date(room.startedAt).getTime();
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    return Math.max(0, totalSeconds - elapsed);
  }
  if (room.status === "paused") {
    return Math.max(0, Number(room.pausedRemainingSeconds) || 0);
  }
  if (room.status === "waiting") {
    return totalSeconds;
  }
  return 0;
}

function canAccessRoom(room, userId) {
  if (!room) return false;
  return room.hostId === userId || room.participantIds?.includes(userId) || room.invitedUserIds?.includes(userId);
}

router.post("/tasks/share", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || "").trim();
    const taskId = String(req.body?.taskId || "").trim();
    const user = await User.findById(req.userId);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到好友" });
    if (!user.friends.some((id) => id.equals(friend._id))) return res.status(403).json({ error: "只能分享給好友" });

    const userData = await UserData.findOne({ userId: user._id }).lean();
    const task = Array.isArray(userData?.tasks) ? userData.tasks.find((item) => String(item.id) === taskId) : null;
    if (!task) return res.status(404).json({ error: "找不到要分享的任務" });

    const share = await SharedTask.create({
      fromUserId: user._id,
      toUserId: friend._id,
      taskSnapshot: task,
      status: "pending"
    });

    const io = getIo(req);
    emitPrivateEvent(io, friend._id.toString(), "shared-task:new", { shareId: share._id.toString(), senderId: user._id.toString() });
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friends:updated", {});
    res.json({ success: true, share: { ...share.toObject(), id: String(share._id) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "分享任務失敗" });
  }
});

router.get("/tasks/shared/incoming", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const shares = await SharedTask.find({ toUserId: req.userId, status: "pending" }).lean();
    const senderIds = shares.map((share) => share.fromUserId).filter(Boolean);
    const senders = await User.find({ _id: { $in: senderIds } }).lean();
    const senderMap = new Map(senders.map((sender) => [String(sender._id), publicUser(sender)]));

    res.json({ shares: shares.map((share) => ({
      ...share,
      id: String(share._id || share.id),
      sender: senderMap.get(String(share.fromUserId)) || { id: String(share.fromUserId), name: "Unknown", email: "" }
    })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得共享任務失敗" });
  }
});

router.post("/tasks/shared/accept", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const shareId = String(req.body?.shareId || "").trim();
    const share = await SharedTask.findOne({ _id: shareId, toUserId: req.userId, status: "pending" });
    if (!share) return res.status(404).json({ error: "找不到共享任務" });

    const userData = await UserData.findOne({ userId: req.userId });
    if (!userData) {
      return res.status(404).json({ error: "找不到使用者資料" });
    }

    const taskCopy = {
      ...share.taskSnapshot,
      id: createTaskId(),
      status: "todo",
      completedAt: null,
      createdAt: new Date().toISOString()
    };
    userData.tasks = Array.isArray(userData.tasks) ? [...userData.tasks, taskCopy] : [taskCopy];
    await userData.save();

    share.status = "accepted";
    await share.save();

    const io = getIo(req);
    emitPrivateEvent(io, share.fromUserId.toString(), "shared-task:accepted", { shareId: share._id.toString(), receiverId: req.userId });
    emitToUsers(io, [req.userId, share.fromUserId.toString()], "friends:updated", {});
    res.json({ success: true, task: taskCopy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "接受共享任務失敗" });
  }
});

router.post("/tasks/shared/reject", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const shareId = String(req.body?.shareId || "").trim();
    const share = await SharedTask.findOne({ _id: shareId, toUserId: req.userId, status: "pending" });
    if (!share) return res.status(404).json({ error: "找不到共享任務" });

    share.status = "rejected";
    await share.save();

    const io = getIo(req);
    emitPrivateEvent(io, share.fromUserId.toString(), "shared-task:rejected", { shareId: share._id.toString(), receiverId: req.userId });
    emitToUsers(io, [req.userId, share.fromUserId.toString()], "friends:updated", {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "拒絕共享任務失敗" });
  }
});

router.post("/focus-room/create", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || "").trim();
    const durationMinutes = Math.max(1, Math.min(240, Number(req.body?.durationMinutes) || 25));
    const user = await User.findById(req.userId);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到好友" });
    if (!user.friends.some((id) => id.equals(friend._id))) return res.status(403).json({ error: "只能與好友建立一起專注房間" });

    const room = await FocusRoom.create({
      hostId: user._id,
      participantIds: [user._id],
      invitedUserIds: [friend._id],
      status: "waiting",
      durationMinutes,
      pausedRemainingSeconds: durationMinutes * 60
    });

    const formatted = normalizeFocusRoom(room);
    const io = getIo(req);
    emitToUsers(io, [req.userId, friend._id.toString()], "focus-room:updated", formatted);
    res.json({ success: true, room: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "建立一起專注房間失敗" });
  }
});

router.post("/focus-room/invite", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const roomId = String(req.body?.roomId || "").trim();
    const friendId = String(req.body?.friendId || "").trim();
    const room = await FocusRoom.findById(roomId);
    if (!room) return res.status(404).json({ error: "找不到專注房間" });
    if (!canAccessRoom(room, req.userId)) return res.status(404).json({ error: "找不到專注房間" });
    if (room.status === "ended") return res.status(400).json({ error: "專注房間已結束" });

    const user = await User.findById(req.userId);
    const friend = await User.findById(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到好友" });
    if (!user.friends.some((id) => id.equals(friend._id))) return res.status(403).json({ error: "只能邀請好友" });

    room.invitedUserIds = Array.from(new Set([...(room.invitedUserIds || []).map(String), friend._id.toString()])).map((id) => mongoose.Types.ObjectId(id));
    await room.save();

    const formatted = normalizeFocusRoom(room);
    const io = getIo(req);
    emitToUsers(io, [req.userId, friend._id.toString()], "focus-room:updated", formatted);
    res.json({ success: true, room: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "邀請一起專注失敗" });
  }
});

router.post("/focus-room/join", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const roomId = String(req.body?.roomId || "").trim();
    const room = await FocusRoom.findById(roomId);
    if (!room) return res.status(404).json({ error: "找不到專注房間" });
    if (room.status === "ended") return res.status(400).json({ error: "專注房間已結束" });
    if (!canAccessRoom(room, req.userId)) return res.status(403).json({ error: "你沒有這個房間的邀請" });

    room.participantIds = Array.from(new Set([...(room.participantIds || []).map(String), req.userId])).map((id) => mongoose.Types.ObjectId(id));
    room.invitedUserIds = (room.invitedUserIds || []).filter((id) => String(id) !== req.userId);
    await room.save();

    const formatted = normalizeFocusRoom(room);
    const io = getIo(req);
    emitToUsers(io, [req.userId, ...(room.participantIds || []).map(String), ...(room.invitedUserIds || []).map(String)], "focus-room:updated", formatted);
    res.json({ success: true, room: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "加入一起專注失敗" });
  }
});

function mutateFocusRoom(req, res, mutator) {
  return async () => {
    const roomId = String(req.body?.roomId || "").trim();
    const room = await FocusRoom.findById(roomId);
    if (!room || !canAccessRoom(room, req.userId)) return res.status(404).json({ error: "找不到專注房間" });
    if (!room.participantIds.some((id) => String(id) === req.userId)) return res.status(403).json({ error: "請先加入專注房間" });
    mutator(room);
    await room.save();
    const formatted = normalizeFocusRoom(room);
    const ids = [room.hostId, ...(room.participantIds || []), ...(room.invitedUserIds || [])].map(String);
    const io = getIo(req);
    emitToUsers(io, ids, "focus-room:updated", formatted);
    res.json({ success: true, room: formatted });
  };
}

router.post("/focus-room/start", async (req, res) => {
  try {
    await mutateFocusRoom(req, res, (room) => {
      if (room.status === "ended") return;
      const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
      const remaining = roomPausedRemaining(room, room, total);
      const startOffset = Math.max(0, total - remaining);
      room.status = "running";
      room.startedAt = new Date(Date.now() - startOffset * 1000);
      room.pausedRemainingSeconds = null;
      room.endedAt = null;
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "啟動專注房間失敗" });
  }
});

function roomPausedRemaining(room, total) {
  if (room.status === "running" && room.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000);
    return Math.max(0, total - elapsed);
  }
  if (room.status === "paused") {
    return Number(room.pausedRemainingSeconds) || 0;
  }
  return total;
}

router.post("/focus-room/pause", async (req, res) => {
  try {
    await mutateFocusRoom(req, res, (room) => {
      if (room.status !== "running") return;
      room.pausedRemainingSeconds = roomRemainingSeconds(room);
      room.status = "paused";
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "暫停專注房間失敗" });
  }
});

router.post("/focus-room/reset", async (req, res) => {
  try {
    await mutateFocusRoom(req, res, (room) => {
      const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
      room.status = "waiting";
      room.startedAt = null;
      room.pausedRemainingSeconds = total;
      room.endedAt = null;
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "重設專注房間失敗" });
  }
});

router.post("/focus-room/end", async (req, res) => {
  try {
    await mutateFocusRoom(req, res, (room) => {
      room.status = "ended";
      room.pausedRemainingSeconds = 0;
      room.endedAt = new Date();
    })();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "結束專注房間失敗" });
  }
});

router.get("/focus-room/active/:friendId", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.params.friendId || "").trim();
    const rooms = await FocusRoom.find({ status: { $ne: "ended" }, $or: [
      { hostId: friendId },
      { participantIds: friendId },
      { invitedUserIds: friendId }
    ] }).sort({ createdAt: -1 }).lean();

    const room = rooms.find((item) => canAccessRoom(item, req.userId)) || null;
    if (!room) return res.json({ room: null });

    const remainingSeconds = roomRemainingSeconds(room);
    if (room.status === "running" && remainingSeconds <= 0) {
      await FocusRoom.updateOne({ _id: room._id }, { status: "ended", pausedRemainingSeconds: 0, endedAt: new Date() });
      return res.json({ room: null });
    }

    res.json({ room: { ...normalizeFocusRoom(room), remainingSeconds } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得一起專注房間失敗" });
  }
});

module.exports = router;
