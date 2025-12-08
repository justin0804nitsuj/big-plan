// ===============================
// Imports
// ===============================
const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");

require("dotenv").config();

// ===============================
// App & Middleware
// ===============================
const app = express();
app.use(cors());
app.use(express.json());

// Secret Key
const JWT_SECRET = process.env.JWT_SECRET || "SUPER_SECRET_KEY_CHANGE_THIS";

// ===============================
// File Paths
// ===============================
const USERS_FILE = path.join(__dirname, "users.json");
const USERDATA_DIR = path.join(__dirname, "userdata");

// 若 userdata 資料夾不存在，建立
if (!fs.existsSync(USERDATA_DIR)) {
  fs.mkdirSync(USERDATA_DIR);
}

// ===============================
// Load & Save Helper Functions
// ===============================
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadUserData(userId) {
  const filePath = path.join(USERDATA_DIR, `${userId}.json`);
  if (!fs.existsSync(filePath)) {
    return {
      tasks: [],
      pomodoroHistory: [],
      settings: { focusMinutes: 25, breakMinutes: 5 },
      dailyStats: {},
    };
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function saveUserData(userId, data) {
  const filePath = path.join(USERDATA_DIR, `${userId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ===============================
// Auth Middleware
// ===============================
function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "缺少 Authorization Header" });

  const token = header.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token 不存在" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Token 無效或已過期" });
  }
}

// ===============================
// Auth Routes
// ===============================

// ------ 註冊 ------
app.post("/auth/register", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return res.status(400).json({ error: "缺少必要欄位 name / email / password" });

  let users = loadUsers();

  if (users.find(u => u.email === email)) {
    return res.status(400).json({ error: "此 email 已被註冊" });
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

  // 建立預設空資料
  saveUserData(newUser.id, {
    tasks: [],
    pomodoroHistory: [],
    settings: { focusMinutes: 25, breakMinutes: 5 },
    dailyStats: {},
  });

  const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: "365d" });

  res.json({
    user: { id: newUser.id, name: newUser.name, email: newUser.email },
    token,
  });
});

// ------ 登入 ------
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;

  let users = loadUsers();
  const user = users.find(u => u.email === email);

  if (!user) return res.status(400).json({ error: "帳號不存在" });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(400).json({ error: "密碼錯誤" });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "365d" });

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    token,
  });
});

// ------ 修改名稱 ------
app.post("/auth/update-name", authMiddleware, (req, res) => {
  const { name } = req.body;

  if (!name) return res.status(400).json({ error: "缺少 name" });

  let users = loadUsers();
  const user = users.find(u => u.id === req.userId);

  if (!user) return res.status(404).json({ error: "找不到使用者" });

  user.name = name;
  saveUsers(users);

  res.json({
    success: true,
    user: { id: user.id, name: user.name, email: user.email },
  });
});

// ------ 修改密碼 ------
app.post("/auth/update-password", authMiddleware, async (req, res) => {
  const { password } = req.body;

  if (!password) return res.status(400).json({ error: "缺少 password" });

  let users = loadUsers();
  const user = users.find(u => u.id === req.userId);

  if (!user) return res.status(404).json({ error: "找不到使用者" });

  user.passwordHash = await bcrypt.hash(password, 10);
  saveUsers(users);

  res.json({ success: true });
});

// ------ 刪除帳號 ------
app.delete("/auth/delete", authMiddleware, (req, res) => {
  let users = loadUsers();
  users = users.filter(u => u.id !== req.userId);
  saveUsers(users);

  const userDataFile = path.join(USERDATA_DIR, `${req.userId}.json`);
  if (fs.existsSync(userDataFile)) fs.unlinkSync(userDataFile);

  res.json({ success: true });
});

// ===============================
// User Data Routes
// ===============================

// ------ 取得使用者全部資料 ------
app.get("/data/full", authMiddleware, (req, res) => {
  const data = loadUserData(req.userId);
  res.json(data);
});

// ------ 更新使用者資料 ------
app.post("/data/full", authMiddleware, (req, res) => {
  const data = req.body;
  saveUserData(req.userId, data);
  res.json({ success: true });
});

// ===============================
// Server Start
// ===============================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend running on port", PORT);
});
