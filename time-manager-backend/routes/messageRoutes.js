const express = require("express");
const mongoose = require("mongoose");
const { User } = require("../models/User");
const Group = require("../models/Group");
const Message = require("../models/Message");
const { singleImageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

function getDmRoomId(userIdA, userIdB) {
  return ["dm", String(userIdA), String(userIdB)].sort().join("_");
}

function formatMessage(message) {
  const msg = typeof message.toObject === "function" ? message.toObject() : message;
  return {
    ...msg,
    id: String(msg._id || msg.id),
    senderId: msg.senderId ? String(msg.senderId) : null,
    receiverId: msg.receiverId ? String(msg.receiverId) : null,
    groupId: msg.groupId ? String(msg.groupId) : null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt
  };
}

function getIo(req) {
  return req.app.get("io");
}

async function requireFriend(req, res, friendId) {
  const friend = await User.findById(friendId);
  if (!friend) {
    res.status(404).json({ error: "找不到好友" });
    return null;
  }

  const user = await User.findById(req.userId);
  if (!user.friends.some((id) => id.equals(friend._id))) {
    res.status(403).json({ error: "只能與好友聊天" });
    return null;
  }

  return friend;
}

router.get(":friendId", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friend = await requireFriend(req, res, req.params.friendId);
    if (!friend) return;

    const roomId = getDmRoomId(req.userId, friend._id);
    const messages = await Message.find({ roomId, deletedFor: { $ne: req.userId } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ messages: messages.reverse().map(formatMessage) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得訊息失敗" });
  }
});

router.post("/send", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const friendId = String(req.body?.friendId || req.body?.receiverId || "").trim();
    const friend = await requireFriend(req, res, friendId);
    if (!friend) return;

    const content = String(req.body?.content || "").trim().slice(0, 1000);
    const type = req.body?.type === "quick" ? "quick" : "text";
    if (!content) {
      return res.status(400).json({ error: "訊息不可為空" });
    }

    const message = await Message.create({
      roomId: getDmRoomId(req.userId, friend._id),
      senderId: req.userId,
      receiverId: friend._id,
      type,
      content,
      imageUrl: "",
      deletedFor: []
    });

    const formatted = formatMessage(message);
    const io = getIo(req);
    io?.to(formatted.roomId).emit("message:new", formatted);
    res.json({ success: true, message: formatted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "送出訊息失敗" });
  }
});

router.post("/upload-image", (req, res) => {
  singleImageUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        const message = uploadErr.code === "LIMIT_FILE_SIZE" ? "圖片大小不可超過 10MB" : uploadErr.message;
        return res.status(400).json({ error: message });
      }
      if (!req.userId) return res.status(401).json({ error: "請先登入" });
      const friendId = String(req.body?.friendId || "").trim();
      const friend = await requireFriend(req, res, friendId);
      if (!friend) {
        if (req.file?.path) fs.unlinkSync(req.file.path);
        return;
      }
      if (!req.file) return res.status(400).json({ error: "請選擇圖片" });

      const imageUrl = `/uploads/chat/${req.file.filename}`;
      const message = await Message.create({
        roomId: getDmRoomId(req.userId, friend._id),
        senderId: req.userId,
        receiverId: friend._id,
        type: "image",
        content: String(req.body?.content || "").trim().slice(0, 1000),
        imageUrl,
        deletedFor: []
      });

      const formatted = formatMessage(message);
      const io = getIo(req);
      io?.to(formatted.roomId).emit("message:new", formatted);
      res.json({ success: true, message: formatted });
    } catch (err) {
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch (_) {}
      }
      console.error(err);
      res.status(500).json({ error: "圖片上傳失敗" });
    }
  });
});

router.post(":messageId/delete-for-me", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: "找不到訊息" });

    const isSender = String(message.senderId) === req.userId;
    const isReceiver = message.receiverId && String(message.receiverId) === req.userId;
    const isGroupMessage = message.groupId != null;
    let group = null;
    if (isGroupMessage) {
      group = await Group.findById(message.groupId);
    }
    const canAccess = isSender || isReceiver || (group?.memberIds?.some((id) => String(id) === req.userId));
    if (!canAccess) return res.status(403).json({ error: "無權限刪除此訊息" });

    await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: mongoose.Types.ObjectId(req.userId) } });
    res.json({ success: true, messageId: req.params.messageId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "刪除訊息失敗" });
  }
});

router.post(":messageId/recall", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: "找不到訊息" });
    if (String(message.senderId) !== req.userId) return res.status(403).json({ error: "只能收回自己的訊息" });

    message.recalledAt = new Date();
    message.content = "";
    message.imageUrl = "";
    await message.save();

    const formatted = formatMessage(message);
    const io = getIo(req);
    if (message.groupId) {
      io?.to(formatted.roomId).emit("group:message:recalled", { messageId: formatted.id });
    } else {
      io?.to(formatted.roomId).emit("message:recalled", { messageId: formatted.id });
    }
    res.json({ success: true, messageId: formatted.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "收回訊息失敗" });
  }
});

module.exports = router;
