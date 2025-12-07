// server.js
// Time Manager Backend - 完整版
// 功能：註冊、登入、修改名稱、修改密碼、刪除帳號、全量資料讀寫、admin users

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 10000;

// ====== CORS & JSON ======
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());

// ====== 路徑設定 ======
const DATA_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const USER_DATA_FILE = path.join(DATA_DIR, "userData.json");

// ====== 確保資料夾 & 檔案存在 ======
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

if (!fs.existsSync(USER_DATA_FILE)) {
  fs.writeFileSync(USER_DATA_FILE, JSON.stringify({}, null, 2));
}

// ====== Helper: 讀寫 Users ======
function loadUsers() {
  const raw = fs.readFileSync(USERS_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ====== Helper: 讀寫 User Data（appData）=====
function loadAllUserData() {
  const raw = fs.readFileSync(USER_DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function saveAllUserData(allData) {
  fs.writeFileSync(USER_DATA_FILE, JSON.stringify(allData, null, 2));
}

const DEFAULT_APP_DATA = {
  tasks: [],
  pomodoroHistory: [],
  settings: {
    focusMinutes: 25,
    breakMinutes: 5,
  },
  dailyStats: {},
};

// ====== JWT ======
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-this";

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const users = loadUsers();
    const found = users.find((u) => u.id === payload.id);
    if (!found) {
      return res.status(401).json({ error: "User not found" });
    }
    req.user = { id: found.id, email: found.email, name: found.name };
    next();
  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ====== Root Test Route ======
app.get("/", (req, res) => {
  res.send("Time Manager Backend is running.");
});

// ====== Auth: Register ======
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: "缺少 name / email / password" });
    }

    const normEmail = String(email).toLowerCase();
    let users = loadUsers();

    if (users.find((u) => u.email === normEmail)) {
      return res.status(400).json({ error: "此 Email 已被註冊" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = {
      id: `u_${Date.now()}`,
      name,
      email: normEmail,
      passwordHash,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    users.push(newUser);
    saveUsers(users);

    // 預設資料
    const allData = loadAllUserData();
    allData[newUser.id] = DEFAULT_APP_DATA;
    saveAllUserData(allData);

    const token = signToken(newUser);
    res.json({
      user: { id: newUser.id, name: newUser.name, email: newUser.email },
      token,
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "註冊失敗" });
  }
});

// ====== Auth: Login ======
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "缺少 email / password" });
    }

    const normEmail = String(email).toLowerCase();
    const users = loadUsers();
    const user = users.find((u) => u.email === normEmail);
    if (!user) {
      return res.status(400).json({ error: "帳號或密碼錯誤" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(400).json({ error: "帳號或密碼錯誤" });
    }

    const token = signToken(user);
    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "登入失敗" });
  }
});

// ====== Auth: 取得目前使用者 ======
app.get("/auth/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ====== Auth: 修改名稱 ======
app.patch("/auth/change-name", authMiddleware, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "缺少 name" });

    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    users[idx].name = name;
    users[idx].updatedAt = new Date().toISOString();
    saveUsers(users);

    const token = signToken(users[idx]);

    res.json({
      user: { id: users[idx].id, name: users[idx].name, email: users[idx].email },
      token,
    });
  } catch (err) {
    console.error("change-name error:", err);
    res.status(500).json({ error: "更新名稱失敗" });
  }
});

// ====== Auth: 修改密碼 ======
app.patch("/auth/change-password", authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "新密碼長度至少 6 碼" });
    }

    const users = loadUsers();
    const idx = users.findIndex((u) => u.id === req.user.id);
    if (idx === -1) return res.status(404).json({ error: "User not found" });

    const hash = await bcrypt.hash(newPassword, 10);
    users[idx].passwordHash = hash;
    users[idx].updatedAt = new Date().toISOString();
    saveUsers(users);

    res.json({ success: true });
  } catch (err) {
    console.error("change-password error:", err);
    res.status(500).json({ error: "更新密碼失敗" });
  }
});

// ====== Auth: 刪除帳號 ======
app.delete("/auth/delete", authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;

    let users = loadUsers();
    const exists = users.find((u) => u.id === userId);
    if (!exists) {
      return res.status(404).json({ error: "User not found" });
    }

    users = users.filter((u) => u.id !== userId);
    saveUsers(users);

    const allData = loadAllUserData();
    if (allData[userId]) {
      delete allData[userId];
      saveAllUserData(allData);
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("delete-user error:", err);
    return res.status(500).json({ error: "刪除帳號失敗" });
  }
});

// ====== 使用者完整資料（tasks 等）=====

// 讀取
app.get("/data/full", authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const allData = loadAllUserData();
    const data = allData[userId] || DEFAULT_APP_DATA;
    res.json(data);
  } catch (err) {
    console.error("GET /data/full error:", err);
    res.status(500).json({ error: "讀取資料失敗" });
  }
});

// 寫入
app.post("/data/full", authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const incoming = req.body || {};

    const merged = {
      tasks: Array.isArray(incoming.tasks) ? incoming.tasks : [],
      pomodoroHistory: Array.isArray(incoming.pomodoroHistory)
        ? incoming.pomodoroHistory
        : [],
      settings: {
        focusMinutes:
          incoming.settings && incoming.settings.focusMinutes
            ? incoming.settings.focusMinutes
            : 25,
        breakMinutes:
          incoming.settings && incoming.settings.breakMinutes
            ? incoming.settings.breakMinutes
            : 5,
      },
      dailyStats:
        incoming.dailyStats && typeof incoming.dailyStats === "object"
          ? incoming.dailyStats
          : {},
    };

    const allData = loadAllUserData();
    allData[userId] = merged;
    saveAllUserData(allData);

    res.json({ success: true });
  } catch (err) {
    console.error("POST /data/full error:", err);
    res.status(500).json({ error: "儲存資料失敗" });
  }
});

// ====== Admin: 列出所有使用者 ======
app.get("/admin/users", (req, res) => {
  const secret = req.query.secret;
  const adminKey = process.env.ADMIN_KEY;

  if (!adminKey || secret !== adminKey) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const users = loadUsers().map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));

  res.json({
    count: users.length,
    users,
  });
});

// ====== 啟動 ======
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
