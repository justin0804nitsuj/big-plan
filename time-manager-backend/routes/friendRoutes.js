const express = require("express");
const mongoose = require("mongoose");
const { User, publicUser } = require("../models/User");

const router = express.Router();

function normalizeObjectId(value) {
  if (!value) return null;
  const stringValue = String(value).trim();
  if (mongoose.isValidObjectId(stringValue)) return mongoose.Types.ObjectId(stringValue);
  return null;
}

async function findUserByIdOrEmail(value) {
  if (!value) return null;
  const candidate = String(value || "").trim();
  if (candidate.includes("@")) {
    return User.findOne({ email: candidate.toLowerCase() });
  }
  if (mongoose.isValidObjectId(candidate)) {
    return User.findById(candidate);
  }
  return User.findOne({ email: candidate.toLowerCase() });
}

function publicFriend(friend, self) {
  const user = publicUser(friend);
  const meta = self?.friendMeta?.[friend._id.toString()] || {};
  return {
    ...user,
    nickname: String(meta.nickname || "").trim(),
    note: String(meta.note || "").trim(),
    originalName: user.name
  };
}

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

router.post("/request", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const user = await User.findById(req.userId);
    const friend = await findUserByIdOrEmail(req.body?.friendId || req.body?.email);
    if (!user || !friend) {
      return res.status(404).json({ error: "找不到要邀請的使用者" });
    }
    if (user._id.equals(friend._id)) {
      return res.status(400).json({ error: "不能邀請自己" });
    }
    if (user.friends.some((id) => id.equals(friend._id))) {
      return res.status(400).json({ error: "你們已經是好友" });
    }
    if (user.incomingRequests.some((id) => id.equals(friend._id)) || friend.outgoingRequests.some((id) => id.equals(user._id))) {
      return res.status(400).json({ error: "對方已邀請你，請直接接受邀請" });
    }
    if (user.outgoingRequests.some((id) => id.equals(friend._id)) || friend.incomingRequests.some((id) => id.equals(user._id))) {
      return res.status(400).json({ error: "已送出好友邀請" });
    }

    await User.updateOne({ _id: user._id }, { $addToSet: { outgoingRequests: friend._id } });
    await User.updateOne({ _id: friend._id }, { $addToSet: { incomingRequests: user._id } });

    const io = getIo(req);
    emitPrivateEvent(io, friend._id.toString(), "friend:request:new", { from: user._id.toString() });
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friends:updated", {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "送出好友邀請失敗" });
  }
});

router.post("/accept", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || req.body?.userId || "").trim();
    const user = await User.findById(req.userId);
    const friend = await findUserByIdOrEmail(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到好友邀請" });
    if (!user.incomingRequests.some((id) => id.equals(friend._id))) {
      return res.status(404).json({ error: "找不到好友邀請" });
    }

    await User.updateOne({ _id: user._id }, {
      $pull: { incomingRequests: friend._id },
      $addToSet: { friends: friend._id }
    });
    await User.updateOne({ _id: friend._id }, {
      $pull: { outgoingRequests: user._id },
      $addToSet: { friends: user._id }
    });

    const io = getIo(req);
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friend:request:accepted", { friendId: friend._id.toString(), userId: user._id.toString() });
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friends:updated", {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "接受好友邀請失敗" });
  }
});

router.post("/reject", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || req.body?.userId || "").trim();
    const user = await User.findById(req.userId);
    const friend = await findUserByIdOrEmail(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到好友邀請" });
    if (!user.incomingRequests.some((id) => id.equals(friend._id))) {
      return res.status(404).json({ error: "找不到好友邀請" });
    }

    await User.updateOne({ _id: user._id }, { $pull: { incomingRequests: friend._id } });
    await User.updateOne({ _id: friend._id }, { $pull: { outgoingRequests: user._id } });

    const io = getIo(req);
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friend:request:rejected", { friendId: friend._id.toString(), userId: user._id.toString() });
    emitToUsers(io, [user._id.toString(), friend._id.toString()], "friends:updated", {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "拒絕好友邀請失敗" });
  }
});

router.get("/list", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const friends = user.friends?.length ? await User.find({ _id: { $in: user.friends } }).lean() : [];
    res.json({ friends: friends.map((friend) => publicFriend(friend, user)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得好友列表失敗" });
  }
});

router.get("/requests", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const user = await User.findById(req.userId).lean();
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const incoming = user.incomingRequests?.length ? await User.find({ _id: { $in: user.incomingRequests } }).lean() : [];
    const outgoing = user.outgoingRequests?.length ? await User.find({ _id: { $in: user.outgoingRequests } }).lean() : [];
    res.json({ incoming: incoming.map(publicUser), outgoing: outgoing.map(publicUser) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得好友邀請失敗" });
  }
});

router.post("/meta", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || "").trim();
    const user = await User.findById(req.userId);
    const friend = await findUserByIdOrEmail(friendId);
    if (!user || !friend) return res.status(404).json({ error: "找不到使用者" });
    if (!user.friends.some((id) => id.equals(friend._id))) {
      return res.status(403).json({ error: "只能設定好友備註" });
    }

    const nickname = String(req.body?.nickname || "").trim().slice(0, 80);
    const note = String(req.body?.note || "").trim().slice(0, 500);
    user.friendMeta = user.friendMeta || {};
    user.friendMeta[friend._id.toString()] = { nickname, note };
    await user.save();

    res.json({ success: true, meta: user.friendMeta[friend._id.toString()] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新好友備註失敗" });
  }
});

module.exports = router;
