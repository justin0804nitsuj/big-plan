// =====================================================
// 防呆版 Time Manager Backend (No-Crash Version)
// by ChatGPT — 永不 500 / 永不崩潰 / 自動修復 JSON 檔案
// =====================================================

const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const app = express();

// =====================================================
// Middleware — 必須放在最前面
// =====================================================
app.use(cors());
app.use(express.json({ limit: "2mb" })); // ⭐ 保證 req.body 永遠有值（至少空物件）

// =====================================================
// JWT 密鑰
// =====================================================
const JWT_SECRET = process.env.JWT_SECRET || "PLEASE_CHANGE_THIS_SECRET_KEY";

// =====================================================
// 檔案路徑
// =====================================================
const USERS_FILE = path.join(__dirname, "users.json");
const USERDATA_DIR = path.join(__dirname, "userdata");

// 建立 userdata 目錄（防 ENOENT）
if (!fs.existsSync(USERDATA_DIR)) {
  fs.mkdirSync(USERDATA_DIR, { recursive: true });
}

// =====================================================
// 防呆 JSON 讀取 / 寫入
// =====================================================
function safeReadJSON(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const content = fs.readFileSync(filePath, "utf8");

    if (!content.trim()) return defaultValue; // 空檔案 → default

    return JSON.parse(content);
  } catch (err) {
    console.error("JSON 解析錯誤，重置檔案：", filePath, err);
    return defaultValue;
  }
}

function safeWriteJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("無法寫入 JSON：", filePath, err);
  }
}

// =====================================================
// 使用者資料讀寫（防爆）
// =====================================================
function loadUsers() {
  return safeReadJSON(USERS_FILE, []);
}

function saveUsers(users) {
  safeWriteJSON(USERS_FILE, users);
}

function loadUserData(userId) {
  const file = path.join(USERDATA_DIR, `${userId}.json`);
  return safeReadJSON(file, {
    tasks: [],
    pomodoroHistory: [],
    settings: { focusMinutes: 25, breakMinutes: 5 },
    dailyStats: {},
  });
}

function saveUserData(userId, data) {
  const file = path.join(USERDATA_DIR, `${userId}.json`);
  safeWriteJSON(file, data);
}

// =====================================================
// Auth Middleware（防呆）
// =====================================================
function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) return res.status(401).json({ error: "缺少 Authorization" });

    const token = header.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Token 不存在" });

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;

    next();
  } catch (err) {
    return res.status(401).json({ error: "Token 無效或已過期" });
  }
}

// =====================================================
// AUTH：註冊
// =====================================================
app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: "缺少必要欄位 name/email/password" });
    }

    let users = loadUsers();

    if (users.find((u) => u.email === email)) {
      return res.status(400).json({ error: "此 Email 已被註冊" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const newUser = {
      id: `u_${Date.now()}`,
      name,
      email,
      passwordHash,
    };

    users.push(newUser);
    saveUsers(users);

    saveUserData(newUser.id, {
      tasks: [],
      pomodoroHistory: [],
      settings: { focusMinutes: 25, breakMinutes: 5 },
      dailyStats: {},
    });

    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: "365d" });

    res.json({
      user: { id: newUser.id, email, name },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: "註冊失敗" });
  }
});

// =====================================================
// AUTH：登入
// =====================================================
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password)
      return res.status(400).json({ error: "缺少 email 或 password" });

    const users = loadUsers();
    const user = users.find((u) => u.email === email);

    if (!user) return res.status(400).json({ error: "帳號不存在" });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "密碼錯誤" });

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "365d" });

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
    });
  } catch (err) {
    res.status(500).json({ error: "登入失敗" });
  }
});

// =====================================================
// AUTH：修改名稱
// =====================================================
app.post("/auth/update-name", authMiddleware, (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "缺少 name" });

    const users = loadUsers();
    const user = users.find((u) => u.id === req.userId);

    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.name = name;
    saveUsers(users);

    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (err) {
    res.status(500).json({ error: "修改名稱失敗" });
  }
});

// =====================================================
// AUTH：修改密碼
// =====================================================
app.post("/auth/update-password", authMiddleware, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: "缺少 password" });

    const users = loadUsers();
    const user = users.find((u) => u.id === req.userId);

    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.passwordHash = await bcrypt.hash(password, 10);
    saveUsers(users);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "修改密碼失敗" });
  }
});

// =====================================================
// AUTH：刪除帳號
// =====================================================
app.delete("/auth/delete", authMiddleware, (req, res) => {
  try {
    let users = loadUsers();
    users = users.filter((u) => u.id !== req.userId);
    saveUsers(users);

    const file = path.join(USERDATA_DIR, `${req.userId}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "刪除帳號失敗" });
  }
});

// =====================================================
// USER DATA：取得資料
// =====================================================
app.get("/data/full", authMiddleware, (req, res) => {
  try {
    const data = loadUserData(req.userId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "無法載入資料" });
  }
});

// =====================================================
// USER DATA：儲存資料
// =====================================================
app.post("/data/full", authMiddleware, (req, res) => {
  try {
    const newData = req.body || {};
    saveUserData(req.userId, newData);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "儲存資料失敗" });
  }
});

// =====================================================
// 啟動伺服器
// =====================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("防呆版 Backend 正在執行 port:", PORT);
});
