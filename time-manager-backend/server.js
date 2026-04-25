const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "PLEASE_CHANGE_THIS_SECRET_KEY";

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.json");
const USERDATA_DIR = path.join(DB_DIR, "userdata");

ensureDir(DB_DIR);
ensureDir(USERDATA_DIR);
ensureFile(USERS_FILE, []);

const allowedOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "2mb" }));

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function ensureFile(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
  }
}

function safeReadJSON(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, "utf8");
    if (!content.trim()) return defaultValue;
    return JSON.parse(content);
  } catch (err) {
    console.error("Failed to read JSON:", filePath, err);
    return defaultValue;
  }
}

function safeWriteJSON(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, filePath);
}

function getEmptyUserData() {
  return {
    tasks: [],
    pomodoroHistory: [],
    settings: { focusMinutes: 25, breakMinutes: 5 },
    dailyStats: {},
    learningProgress: { subjects: [] }
  };
}

function normalizeUserData(data) {
  const empty = getEmptyUserData();
  const value = data && typeof data === "object" ? data : {};
  return {
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    pomodoroHistory: Array.isArray(value.pomodoroHistory) ? value.pomodoroHistory : [],
    settings: {
      focusMinutes: Number(value.settings?.focusMinutes) || empty.settings.focusMinutes,
      breakMinutes: Number(value.settings?.breakMinutes) || empty.settings.breakMinutes
    },
    dailyStats: value.dailyStats && typeof value.dailyStats === "object" ? value.dailyStats : {},
    learningProgress: {
      subjects: Array.isArray(value.learningProgress?.subjects) ? value.learningProgress.subjects : []
    }
  };
}

function loadUsers() {
  return safeReadJSON(USERS_FILE, []);
}

function saveUsers(users) {
  safeWriteJSON(USERS_FILE, users);
}

function getUserDataFile(userId) {
  return path.join(USERDATA_DIR, `${userId}.json`);
}

function loadUserData(userId) {
  return normalizeUserData(safeReadJSON(getUserDataFile(userId), getEmptyUserData()));
}

function saveUserData(userId, data) {
  safeWriteJSON(getUserDataFile(userId), normalizeUserData(data));
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");
    if (type !== "Bearer" || !token) return res.status(401).json({ error: "缺少登入憑證" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (_) {
    res.status(401).json({ error: "登入已過期，請重新登入" });
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/auth/register", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;

    if (!name || !validateEmail(email) || !validatePassword(password)) {
      return res.status(400).json({ error: "請輸入姓名、有效 Email，且密碼至少 8 個字元" });
    }

    const users = loadUsers();
    if (users.some((user) => user.email === email)) {
      return res.status(400).json({ error: "這個 Email 已經註冊" });
    }

    const user = {
      id: `u_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      createdAt: new Date().toISOString()
    };

    users.push(user);
    saveUsers(users);
    saveUserData(user.id, getEmptyUserData());

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "365d" });
    res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "註冊失敗" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = req.body?.password;
    if (!validateEmail(email) || !password) return res.status(400).json({ error: "請輸入 Email 和密碼" });

    const user = loadUsers().find((item) => item.email === email);
    if (!user) return res.status(400).json({ error: "帳號或密碼錯誤" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "帳號或密碼錯誤" });

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "365d" });
    res.json({ user: publicUser(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "登入失敗" });
  }
});

app.post("/auth/update-name", authMiddleware, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "請輸入姓名" });

    const users = loadUsers();
    const user = users.find((item) => item.id === req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.name = name;
    saveUsers(users);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新姓名失敗" });
  }
});

app.post("/auth/update-password", authMiddleware, async (req, res) => {
  try {
    const password = req.body?.password;
    if (!validatePassword(password)) return res.status(400).json({ error: "密碼至少需要 8 個字元" });

    const users = loadUsers();
    const user = users.find((item) => item.id === req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.passwordHash = await bcrypt.hash(password, 10);
    saveUsers(users);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

app.delete("/auth/delete", authMiddleware, (req, res) => {
  try {
    saveUsers(loadUsers().filter((user) => user.id !== req.userId));
    const dataFile = getUserDataFile(req.userId);
    if (fs.existsSync(dataFile)) fs.unlinkSync(dataFile);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "刪除帳號失敗" });
  }
});

app.get("/data/full", authMiddleware, (req, res) => {
  res.json(loadUserData(req.userId));
});

app.post("/data/full", authMiddleware, (req, res) => {
  saveUserData(req.userId, req.body || {});
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Personal Learning Manager backend running on port ${PORT}`);
});
