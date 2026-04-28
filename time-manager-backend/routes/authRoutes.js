const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { User, publicUser } = require("../models/User");
const UserData = require("../models/UserData");

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

function validateEmail(email) {
  return typeof email === "string" && email.includes("@") && email.trim().length > 3;
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

router.post("/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;

    if (!name || !validateEmail(email) || !validatePassword(password)) {
      return res.status(400).json({ error: "請提供名稱、有效 Email，且密碼至少 8 個字元" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "這個 Email 已經註冊" });
    }

    const user = new User({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      friendMeta: {},
      role: "user"
    });

    await user.save();
    await UserData.create({ userId: user._id });

    const token = jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: "365d" });
    res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "註冊失敗" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!validateEmail(email) || !password) {
      return res.status(400).json({ error: "請提供 Email 和密碼" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "帳號或密碼錯誤" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(400).json({ error: "帳號或密碼錯誤" });
    }

    const token = jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: "365d" });
    res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "登入失敗" });
  }
});

router.post("/update-name", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "請提供名稱" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.name = name;
    await user.save();
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新名稱失敗" });
  }
});

router.post("/update-password", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const password = req.body?.password;
    if (!validatePassword(password)) {
      return res.status(400).json({ error: "密碼至少需要 8 個字元" });
    }

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.passwordHash = await bcrypt.hash(password, 10);
    await user.save();
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

router.delete("/delete", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });

    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

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

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "刪除帳號失敗" });
  }
});

module.exports = router;
