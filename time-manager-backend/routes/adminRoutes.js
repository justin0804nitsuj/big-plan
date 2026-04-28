const express = require("express");
const fs = require("fs");
const path = require("path");
const { User, publicUser } = require("../models/User");
const UserData = require("../models/UserData");
const Group = require("../models/Group");
const Thread = require("../models/Thread");
const adminMiddleware = require("../middleware/adminMiddleware");

const router = express.Router();
const ENABLE_ADMIN_DANGER = String(process.env.ENABLE_ADMIN_DANGER || "false").toLowerCase() === "true";

router.get("/me", (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    if (!adminMiddleware.isAdminUser(user)) return res.status(403).json({ error: "需要管理員權限" });
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得管理員資訊失敗" });
  }
});

router.get("/users", adminMiddleware, async (_req, res) => {
  try {
    const users = await User.find().lean();
    res.json({ users: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      friendsCount: Array.isArray(user.friends) ? user.friends.length : 0,
      incomingRequestsCount: Array.isArray(user.incomingRequests) ? user.incomingRequests.length : 0,
      outgoingRequestsCount: Array.isArray(user.outgoingRequests) ? user.outgoingRequests.length : 0
    })) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得使用者列表失敗" });
  }
});

router.get("/users/:userId", adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const userData = await UserData.findOne({ userId: user._id }).lean();
    const groupsCount = await Group.countDocuments({ memberIds: user._id });
    const threadsCount = await Thread.countDocuments({ authorId: user._id });

    res.json({
      user: publicUser(user),
      stats: {
        tasks: Array.isArray(userData?.tasks) ? userData.tasks.length : 0,
        focusSessions: Array.isArray(userData?.focusSessions) ? userData.focusSessions.length : 0,
        friends: Array.isArray(user.friends) ? user.friends.length : 0,
        groups: groupsCount,
        threads: threadsCount
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得使用者資料失敗" });
  }
});

router.post("/users/:userId/update", adminMiddleware, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!name || !email || !email.includes("@")) {
      return res.status(400).json({ error: "請提供有效的名稱與 Email" });
    }
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const exists = await User.findOne({ email, _id: { $ne: user._id } });
    if (exists) return res.status(400).json({ error: "此 Email 已被使用" });

    user.name = name;
    user.email = email;
    await user.save();
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新使用者資料失敗" });
  }
});

router.post("/users/:userId/reset-data", adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    await UserData.findOneAndUpdate({ userId: user._id }, {
      tasks: [],
      pomodoroHistory: [],
      focusSessions: [],
      distractions: [],
      settings: {},
      dailyStats: {},
      learningProgress: {},
      aiLogs: []
    }, { upsert: true });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "重設使用者資料失敗" });
  }
});

router.delete("/users/:userId", adminMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const confirmSelfDelete = req.body?.confirmSelfDelete === true || req.body?.confirmSelfDelete === "true";
    if (String(user._id) === req.userId && !confirmSelfDelete) {
      return res.status(400).json({ error: "禁止刪除自己，除非確認 self delete" });
    }

    await User.deleteOne({ _id: user._id });
    await UserData.deleteOne({ userId: user._id });
    await User.updateMany({
      $or: [
        { friends: user._id },
        { incomingRequests: user._id },
        { outgoingRequests: user._id }
      ]
    }, {
      $pull: {
        friends: user._id,
        incomingRequests: user._id,
        outgoingRequests: user._id
      }
    });
    await User.updateMany({ [`friendMeta.${user._id.toString()}`]: { $exists: true } }, {
      $unset: {
        [`friendMeta.${user._id.toString()}`]: ""
      }
    });
    await Group.updateMany({ memberIds: user._id }, { $pull: { memberIds: user._id } });
    await Group.updateMany({ ownerId: user._id }, { $unset: { ownerId: "" } });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "刪除使用者失敗" });
  }
});

router.post("/delete-all-test-data", adminMiddleware, async (req, res) => {
  try {
    if (!ENABLE_ADMIN_DANGER) return res.status(403).json({ error: "危險操作未啟用" });
    const confirmText = String(req.body?.confirmText || "").trim();
    if (confirmText !== "DELETE ALL TEST DATA") {
      return res.status(400).json({ error: "請輸入 DELETE ALL TEST DATA" });
    }

    await User.deleteMany({});
    await UserData.deleteMany({});
    await require("../models/Message").deleteMany({});
    await require("../models/Group").deleteMany({});
    await require("../models/Thread").deleteMany({});
    await require("../models/ThreadReply").deleteMany({});
    await require("../models/SharedTask").deleteMany({});
    await require("../models/FocusRoom").deleteMany({});

    const uploadDir = path.join(__dirname, "..", "uploads", "chat");
    if (fs.existsSync(uploadDir)) {
      fs.readdirSync(uploadDir).forEach((file) => {
        const fullPath = path.join(uploadDir, file);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "刪除所有測試資料失敗" });
  }
});

module.exports = router;
