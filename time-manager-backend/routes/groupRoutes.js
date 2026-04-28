const express = require("express");
const mongoose = require("mongoose");
const { User } = require("../models/User");
const Group = require("../models/Group");
const Message = require("../models/Message");
const { singleImageUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

function formatGroup(group) {
  const obj = typeof group.toObject === "function" ? group.toObject() : group;
  return {
    id: String(obj._id || obj.id),
    name: obj.name,
    description: obj.description,
    ownerId: obj.ownerId ? String(obj.ownerId) : null,
    memberIds: Array.isArray(obj.memberIds) ? obj.memberIds.map(String) : [],
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
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

async function requireGroup(req, res) {
  const group = await Group.findById(req.params.groupId);
  if (!group) {
    res.status(404).json({ error: "找不到群組" });
    return null;
  }
  if (!group.memberIds.some((id) => String(id) === req.userId)) {
    res.status(403).json({ error: "你不是這個群組的成員" });
    return null;
  }
  return group;
}

async function requireFriend(userId, friendId) {
  const user = await User.findById(userId);
  const friend = await User.findById(friendId);
  if (!user || !friend) return null;
  if (!user.friends.some((id) => id.equals(friend._id))) return null;
  return friend;
}

function getGroupRoomId(groupId) {
  return `group_${groupId}`;
}

router.post("/create", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (!name || name.length > 40) return res.status(400).json({ error: "群組名稱長度需為 1~40 字元" });
    if (description.length > 200) return res.status(400).json({ error: "群組描述長度不可超過 200 字元" });

    const group = await Group.create({
      name,
      description,
      ownerId: mongoose.Types.ObjectId(req.userId),
      memberIds: [mongoose.Types.ObjectId(req.userId)]
    });

    res.json({ success: true, group: formatGroup(group) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "建立群組失敗" });
  }
});

router.get("/list", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const groups = await Group.find({ memberIds: req.userId }).lean();
    res.json({ groups: groups.map(formatGroup) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組列表失敗" });
  }
});

router.get("/:groupId", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await requireGroup(req, res);
    if (!group) return;

    const members = await User.find({ _id: { $in: group.memberIds } }).lean();
    res.json({
      group: {
        ...formatGroup(group),
        members: members.map((member) => ({
          ...member,
          id: String(member._id || member.id),
          name: member.name,
          email: member.email
        }))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組資料失敗" });
  }
});

router.post("/:groupId/invite", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!group.memberIds.some((id) => String(id) === req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    const friend = await requireFriend(req.userId, String(req.body?.friendId || "").trim());
    if (!friend) return res.status(404).json({ error: "找不到好友" });
    if (group.memberIds.some((id) => id.equals(friend._id))) return res.status(400).json({ error: "這個好友已經在群組中" });

    group.memberIds.push(friend._id);
    await group.save();
    res.json({ success: true, group: formatGroup(group) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "邀請好友加入群組失敗" });
  }
});

router.post("/:groupId/leave", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!group.memberIds.some((id) => String(id) === req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    if (group.ownerId && String(group.ownerId) === req.userId) {
      const remaining = group.memberIds.filter((id) => String(id) !== req.userId);
      if (remaining.length > 0) {
        group.ownerId = remaining[0];
        group.memberIds = remaining;
        await group.save();
        return res.json({ success: true, group: formatGroup(group) });
      }
      await Group.deleteOne({ _id: group._id });
      return res.json({ success: true });
    }

    group.memberIds = group.memberIds.filter((id) => String(id) !== req.userId);
    await group.save();
    res.json({ success: true, group: formatGroup(group) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "離開群組失敗" });
  }
});

router.post("/:groupId/update", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!group.ownerId || String(group.ownerId) !== req.userId) return res.status(403).json({ error: "只有群組擁有者可以修改群組" });

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (!name || name.length > 40) return res.status(400).json({ error: "群組名稱長度需為 1~40 字元" });
    if (description.length > 200) return res.status(400).json({ error: "群組描述長度不可超過 200 字元" });

    group.name = name;
    group.description = description;
    await group.save();
    res.json({ success: true, group: formatGroup(group) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新群組失敗" });
  }
});

router.get("/:groupId/messages", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await requireGroup(req, res);
    if (!group) return;

    const messages = await Message.find({ roomId: getGroupRoomId(req.params.groupId), deletedFor: { $ne: req.userId } })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    res.json({ messages: messages.reverse().map(formatMessage) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組訊息失敗" });
  }
});

router.post("/:groupId/upload-image", (req, res) => {
  singleImageUpload(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        const message = uploadErr.code === "LIMIT_FILE_SIZE" ? "圖片大小不可超過 10MB" : uploadErr.message;
        return res.status(400).json({ error: message });
      }
      if (!req.userId) return res.status(401).json({ error: "請先登入" });
      const group = await requireGroup(req, res);
      if (!group) return;
      if (!req.file) return res.status(400).json({ error: "沒有上傳圖片" });

      const imageUrl = `/uploads/chat/${req.file.filename}`;
      const message = await Message.create({
        roomId: getGroupRoomId(req.params.groupId),
        senderId: req.userId,
        receiverId: null,
        groupId: group._id,
        type: "image",
        content: "",
        imageUrl,
        deletedFor: []
      });

      const formatted = formatMessage(message);
      const io = getIo(req);
      io?.to(formatted.roomId).emit("group:message:new", formatted);
      res.json({ success: true, message: formatted });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "上傳圖片失敗" });
    }
  });
});

router.post("/:groupId/remove-member", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const group = await Group.findById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!group.ownerId || String(group.ownerId) !== req.userId) return res.status(403).json({ error: "只有群組擁有者可以移除成員" });

    const memberId = String(req.body?.memberId || "").trim();
    if (!memberId) return res.status(400).json({ error: "請提供要移除的成員" });
    if (memberId === req.userId) return res.status(400).json({ error: "擁有者不能移除自己" });
    if (!group.memberIds.some((id) => String(id) === memberId)) return res.status(404).json({ error: "這個使用者不是群組成員" });

    group.memberIds = group.memberIds.filter((id) => String(id) !== memberId);
    await group.save();
    res.json({ success: true, group: formatGroup(group) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "移除群組成員失敗" });
  }
});

module.exports = router;
