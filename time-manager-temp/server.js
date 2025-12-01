// server.js
// 簡易後端：支援註冊、登入、取得/儲存 appData（時間管理工具）
// 使用：Node.js + Express + JSON 檔案當資料庫

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();

// ====== 基本設定 ======
const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_PRODUCTION";

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.json");
const DATA_FILE = path.join(DB_DIR, "data.json");

// 若 db 資料夾不存在就建立
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR);
}

// ====== Middleware ======
app.use(cors({
  origin: "*", // 開發階段先全部開放，之後可改成你的前端網址
}));
app.use(express.json());

// 簡單請求 log
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ====== 檔案存取工具函式 ======
function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to parse JSON from ${filePath}:`, e);
    return null;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

// 確保 users.json, data.json 至少是基本結構
function ensureDbFiles() {
  if (!fs.existsSync(USERS_FILE)) {
    writeJson(USERS_FILE, []);
  }
  if (!fs.existsSync(DATA_FILE)) {
    writeJson(DATA_FILE, {});
  }
}
ensureDbFiles();

// ====== JWT / Auth 工具 ======
function generateToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, email }
    next();
  } catch (err) {
    console.error("JWT verify failed:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ====== 預設的 appData 結構（給新用戶用） ======
function createDefaultAppData() {
  return {
    tasks: [],
    pomodoroHistory: [],
    settings: {
      focusMinutes: 25,
      breakMinutes: 5,
    },
    dailyStats: {},
  };
}

// ====== Auth Routes ======

// 註冊
app.post("/auth/register", (req, res) => {
  const { email, password, name } = req.body || {};

  if (!email || !password || !name) {
    return res.status(400).json({ error: "email, password, name 為必填" });
  }

  const users = readJson(USERS_FILE) || [];

  // 檢查 email 是否已存在
  const existing = users.find((u) => u.email === email);
  if (existing) {
    return res.status(409).json({ error: "此 email 已註冊" });
  }

  const id = `u_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const passwordHash = bcrypt.hashSync(password, 10);

  const newUser = {
    id,
    email,
    passwordHash,
    name,
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  writeJson(USERS_FILE, users);

  // 為此用戶建立預設 appData
  const data = readJson(DATA_FILE) || {};
  data[id] = createDefaultAppData();
  writeJson(DATA_FILE, data);

  const token = generateToken(newUser);
  const userSafe = { id: newUser.id, email: newUser.email, name: newUser.name };

  return res.json({
    token,
    user: userSafe,
  });
});

// 登入
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "email, password 為必填" });
  }

  const users = readJson(USERS_FILE) || [];
  const user = users.find((u) => u.email === email);
  if (!user) {
    return res.status(401).json({ error: "帳號或密碼錯誤" });
  }

  const ok = bcrypt.compareSync(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "帳號或密碼錯誤" });
  }

  const token = generateToken(user);
  const userSafe = { id: user.id, email: user.email, name: user.name };

  return res.json({
    token,
    user: userSafe,
  });
});

// 取得目前登入者資訊
app.get("/auth/me", authMiddleware, (req, res) => {
  const users = readJson(USERS_FILE) || [];
  const user = users.find((u) => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  const userSafe = { id: user.id, email: user.email, name: user.name };
  return res.json({ user: userSafe });
});

// ====== Data Routes ======

// 取得完整 appData
app.get("/data/full", authMiddleware, (req, res) => {
  const data = readJson(DATA_FILE) || {};
  const userId = req.user.id;

  if (!data[userId]) {
    // 若沒有就建立預設
    data[userId] = createDefaultAppData();
    writeJson(DATA_FILE, data);
  }

  return res.json(data[userId]);
});

// 覆寫完整 appData
app.post("/data/full", authMiddleware, (req, res) => {
  const incoming = req.body;

  // 可以在這裡做一些基本驗證（可簡化）
  if (
    typeof incoming !== "object" ||
    !incoming ||
    !Array.isArray(incoming.tasks) ||
    !Array.isArray(incoming.pomodoroHistory) ||
    typeof incoming.settings !== "object" ||
    typeof incoming.dailyStats !== "object"
  ) {
    return res.status(400).json({ error: "appData 結構不正確" });
  }

  const data = readJson(DATA_FILE) || {};
  const userId = req.user.id;

  data[userId] = incoming;
  writeJson(DATA_FILE, data);

  return res.json({ ok: true });
});

// （可選）僅更新部分資料：例如 tasks
app.patch("/data/tasks", authMiddleware, (req, res) => {
  const { tasks } = req.body || {};
  if (!Array.isArray(tasks)) {
    return res.status(400).json({ error: "tasks 必須是陣列" });
  }

  const data = readJson(DATA_FILE) || {};
  const userId = req.user.id;

  if (!data[userId]) {
    data[userId] = createDefaultAppData();
  }
  data[userId].tasks = tasks;
  writeJson(DATA_FILE, data);

  return res.json({ ok: true });
});

// ====== 啟動伺服器 ======
app.listen(PORT, () => {
  console.log(`Time Manager backend listening on http://localhost:${PORT}`);
});
