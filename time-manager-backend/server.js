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
const MESSAGES_FILE = path.join(DB_DIR, "messages.json");
const SHARED_TASKS_FILE = path.join(DB_DIR, "sharedTasks.json");
const FOCUS_ROOMS_FILE = path.join(DB_DIR, "focusRooms.json");
const USERDATA_DIR = path.join(DB_DIR, "userdata");

ensureDir(DB_DIR);
ensureDir(USERDATA_DIR);
ensureFile(USERS_FILE, []);
ensureFile(MESSAGES_FILE, []);
ensureFile(SHARED_TASKS_FILE, []);
ensureFile(FOCUS_ROOMS_FILE, []);

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
    focusSessions: [],
    distractions: [],
    settings: {
      focusMinutes: 25,
      breakMinutes: 5,
      language: "zh-Hant"
    },
    dailyStats: {},
    learningProgress: {
      subjects: []
    },
    aiLogs: []
  };
}

function normalizeUserData(data) {
  const empty = getEmptyUserData();
  const value = data && typeof data === "object" ? data : {};
  const learningProgress = value.learningProgress && typeof value.learningProgress === "object"
    ? value.learningProgress
    : { subjects: Array.isArray(value.subjects) ? value.subjects : [] };

  return {
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    pomodoroHistory: Array.isArray(value.pomodoroHistory) ? value.pomodoroHistory : [],
    focusSessions: Array.isArray(value.focusSessions) ? value.focusSessions : [],
    distractions: Array.isArray(value.distractions) ? value.distractions : [],
    settings: {
      focusMinutes: Math.max(1, Number(value.settings?.focusMinutes) || empty.settings.focusMinutes),
      breakMinutes: Math.max(1, Number(value.settings?.breakMinutes) || empty.settings.breakMinutes),
      language: value.settings?.language || empty.settings.language
    },
    dailyStats: value.dailyStats && typeof value.dailyStats === "object" ? value.dailyStats : {},
    learningProgress: {
      subjects: Array.isArray(learningProgress.subjects) ? learningProgress.subjects : []
    },
    aiLogs: Array.isArray(value.aiLogs) ? value.aiLogs.slice(0, 50) : []
  };
}

function uniqueStrings(value) {
  return Array.from(new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean)));
}

function normalizeFriendMeta(meta) {
  const value = meta && typeof meta === "object" ? meta : {};
  return Object.fromEntries(Object.entries(value).map(([friendId, item]) => [
    friendId,
    {
      nickname: String(item?.nickname || "").slice(0, 80),
      note: String(item?.note || "").slice(0, 500)
    }
  ]));
}

function normalizeUserAccount(user) {
  return {
    ...user,
    friends: uniqueStrings(user?.friends),
    incomingRequests: uniqueStrings(user?.incomingRequests),
    outgoingRequests: uniqueStrings(user?.outgoingRequests),
    friendMeta: normalizeFriendMeta(user?.friendMeta)
  };
}

function loadUsers() {
  return safeReadJSON(USERS_FILE, []).map(normalizeUserAccount);
}

function saveUsers(users) {
  safeWriteJSON(USERS_FILE, users.map(normalizeUserAccount));
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

function loadMessages() {
  return safeReadJSON(MESSAGES_FILE, []);
}

function saveMessages(messages) {
  safeWriteJSON(MESSAGES_FILE, messages);
}

function loadSharedTasks() {
  return safeReadJSON(SHARED_TASKS_FILE, []);
}

function saveSharedTasks(shares) {
  safeWriteJSON(SHARED_TASKS_FILE, shares);
}

function loadFocusRooms() {
  return safeReadJSON(FOCUS_ROOMS_FILE, []);
}

function saveFocusRooms(rooms) {
  safeWriteJSON(FOCUS_ROOMS_FILE, rooms);
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function areFriends(user, friendId) {
  return Boolean(user?.friends?.includes(friendId));
}

function getUserById(users, userId) {
  return users.find((item) => item.id === userId);
}

function getUserByEmail(users, email) {
  return users.find((item) => item.email === String(email || "").trim().toLowerCase());
}

function getRequestedFriend(users, body) {
  const friendId = String(body?.friendId || body?.userId || "").trim();
  const email = String(body?.email || body?.friendEmail || "").trim().toLowerCase();
  if (friendId) return getUserById(users, friendId);
  if (email) return getUserByEmail(users, email);
  return null;
}

function getTodayFriendStats(userId) {
  const data = loadUserData(userId);
  const today = todayKey();
  const focusMinutes = Number(data.dailyStats?.[today]?.focusMinutes) || data.focusSessions
    .filter((session) => (session.endedAt || session.startedAt || "").slice(0, 10) === today)
    .reduce((sum, session) => sum + Number(session.durationMinutes || 0), 0);
  const completedTasks = data.tasks.filter((task) => task.completedAt?.slice(0, 10) === today).length;
  return { focusMinutes, completedTasks };
}

function publicFriend(user, viewer) {
  const meta = viewer.friendMeta?.[user.id] || { nickname: "", note: "" };
  return {
    ...publicUser(user),
    originalName: user.name,
    nickname: meta.nickname || "",
    note: meta.note || "",
    today: getTodayFriendStats(user.id)
  };
}

function requireFriend(req, res, users, friendId) {
  const user = getUserById(users, req.userId);
  if (!user) {
    res.status(404).json({ error: "找不到使用者" });
    return null;
  }
  const friend = getUserById(users, friendId);
  if (!friend) {
    res.status(404).json({ error: "找不到好友" });
    return null;
  }
  if (!areFriends(user, friend.id)) {
    res.status(403).json({ error: "只能與好友使用此功能" });
    return null;
  }
  return { user, friend };
}

function roomRemainingSeconds(room) {
  const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
  if (room.status === "running" && room.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000);
    return Math.max(0, total - elapsed);
  }
  if (room.status === "paused" || room.status === "waiting") {
    return Math.max(0, Number(room.pausedRemainingSeconds ?? total));
  }
  return 0;
}

function canAccessRoom(room, userId) {
  return room.hostId === userId
    || room.participantIds?.includes(userId)
    || room.invitedUserIds?.includes(userId);
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
    if (type !== "Bearer" || !token) return res.status(401).json({ error: "請先登入" });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (_) {
    res.status(401).json({ error: "登入狀態已失效，請重新登入" });
  }
}

function todayKey() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateDiffFromToday(dateString) {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  const today = new Date(`${todayKey()}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target - today) / 86400000);
}

function calculateTaskScore(task) {
  if (!task || task.status === "done") return 0;
  if (task.status === "deferred") return 5;

  let score = 10;
  score += { high: 35, medium: 20, low: 8 }[task.priority] || 15;
  score += { high: 10, medium: 6, low: 2 }[task.energyRequired] || 4;
  score += task.taskType === "deep" ? 8 : 3;
  score += task.status === "doing" ? 12 : 0;

  const dueIn = dateDiffFromToday(task.dueDate);
  if (dueIn !== null) {
    if (dueIn < 0) score += 45 + Math.min(25, Math.abs(dueIn) * 3);
    else if (dueIn === 0) score += 30;
    else if (dueIn === 1) score += 18;
    else if (dueIn <= 7) score += 10;
  }

  const estimate = Number(task.estimateMinutes) || 0;
  if (estimate > 0 && estimate <= 30) score += 8;
  else if (estimate <= 90) score += 5;
  else if (estimate > 180) score -= 8;

  return Math.max(0, Math.round(score));
}

function getAIContext(body) {
  const data = body && typeof body === "object" ? body : {};
  const tasks = Array.isArray(data.tasks) ? data.tasks : [];
  const focusSessions = Array.isArray(data.focusSessions) ? data.focusSessions : [];
  const distractions = Array.isArray(data.distractions) ? data.distractions : [];
  return {
    tasks,
    focusSessions,
    distractions,
    dailyStats: data.dailyStats && typeof data.dailyStats === "object" ? data.dailyStats : {},
    learningProgress: data.learningProgress && typeof data.learningProgress === "object" ? data.learningProgress : { subjects: [] },
    currentTask: data.currentTask || null
  };
}

function getOpenTasks(context) {
  return context.tasks
    .filter((task) => task.status !== "done" && task.status !== "deferred")
    .map((task) => ({ ...task, score: calculateTaskScore(task) }))
    .sort((a, b) => b.score - a.score);
}

function taskTypeText(type) {
  return type === "shallow" ? "Shallow" : "Deep";
}

function energyText(energy) {
  return { low: "低能量", medium: "中能量", high: "高能量" }[energy] || "中能量";
}

function buildMockPlanDay(context) {
  const tasks = getOpenTasks(context);
  const items = tasks.slice(0, 4).map((task, index) => {
    const block = index === 0 ? "第一個深度專注區塊" : `第 ${index + 1} 個處理區塊`;
    return `${block}：${task.title}（${task.estimateMinutes || 25} 分，Score ${task.score}）`;
  });

  return {
    title: "今天的建議安排",
    summary: items.length ? "先處理高分任務，再用低能量時段收尾淺層工作。" : "目前沒有待辦任務，可以安排學習或回顧。",
    items: items.length ? items : ["新增今天最重要的一個任務", "完成一輪 25 分鐘專注", "寫下今日回顧"],
    taskId: tasks[0]?.id || null
  };
}

function buildMockSuggestTask(context) {
  const tasks = getOpenTasks(context);
  const task = context.currentTask || tasks[0] || null;
  if (!task) {
    return {
      title: "下一個任務建議",
      summary: "目前沒有可建議的任務。",
      items: ["新增一個明確、可完成的下一步"],
      taskId: null
    };
  }

  const score = calculateTaskScore(task);
  return {
    title: "下一個任務建議",
    summary: `建議先做「${task.title}」，它目前最適合成為下一個焦點。`,
    items: [
      `Score：${score}`,
      `類型：${taskTypeText(task.taskType)}，能量：${energyText(task.energyRequired)}`,
      `預估：${task.estimateMinutes || 25} 分`
    ],
    taskId: task.id
  };
}

function buildMockBreakdownTask(context) {
  const tasks = getOpenTasks(context);
  const task = context.currentTask || tasks[0] || null;
  const title = task?.title || "目前任務";
  const subtasks = ["定義完成標準", "收集必要資料", "完成第一版", "檢查與修正"];

  return {
    title: `拆解：${title}`,
    summary: "先把任務拆成可以在 10 到 25 分鐘內完成的小步驟。",
    items: [...subtasks, "記錄下一步"],
    subtasks,
    taskId: task?.id || null
  };
}

function buildMockAnalyze(context) {
  const sevenDaysAgo = Date.now() - 6 * 86400000;
  const recentSessions = context.focusSessions.filter((session) => {
    const ended = new Date(session.endedAt || session.startedAt || 0).getTime();
    return ended >= sevenDaysAgo;
  });
  const focusMinutes = recentSessions.reduce((sum, session) => sum + Number(session.durationMinutes || 0), 0);
  const avgScoreValues = recentSessions.map((session) => Number(session.focusScore || 0)).filter(Boolean);
  const avgScore = avgScoreValues.length
    ? Math.round((avgScoreValues.reduce((sum, score) => sum + score, 0) / avgScoreValues.length) * 10) / 10
    : 0;
  const recentDistractions = context.distractions.filter((item) => new Date(item.createdAt || 0).getTime() >= sevenDaysAgo).length;

  return {
    title: "效率分析",
    summary: "這是依據最近 7 天資料產生的 mock 分析。",
    items: [
      `專注總分鐘：${focusMinutes}`,
      `專注 session：${recentSessions.length}`,
      `分心紀錄：${recentDistractions}`,
      `平均專注品質：${avgScore || "-"}`
    ]
  };
}

function handleMockAI(builder) {
  return (req, res) => {
    const context = getAIContext(req.body);
    res.json({
      ...builder(context),
      generatedAt: new Date().toISOString()
    });
  };
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
      return res.status(400).json({ error: "請提供名稱、有效 Email，且密碼至少 8 個字元" });
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
      friends: [],
      incomingRequests: [],
      outgoingRequests: [],
      friendMeta: {},
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
    if (!validateEmail(email) || !password) return res.status(400).json({ error: "請提供 Email 和密碼" });

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
    if (!name) return res.status(400).json({ error: "請提供名稱" });

    const users = loadUsers();
    const user = users.find((item) => item.id === req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });

    user.name = name;
    saveUsers(users);
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新名稱失敗" });
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

app.post("/friends/request", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    const friend = getRequestedFriend(users, req.body);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    if (!friend) return res.status(404).json({ error: "找不到要邀請的使用者" });
    if (friend.id === user.id) return res.status(400).json({ error: "不能邀請自己" });
    if (areFriends(user, friend.id)) return res.status(400).json({ error: "你們已經是好友" });
    if (user.incomingRequests.includes(friend.id) || friend.outgoingRequests.includes(user.id)) {
      return res.status(400).json({ error: "對方已邀請你，請直接接受邀請" });
    }
    if (user.outgoingRequests.includes(friend.id) || friend.incomingRequests.includes(user.id)) {
      return res.status(400).json({ error: "已送出好友邀請" });
    }

    user.outgoingRequests = uniqueStrings([...user.outgoingRequests, friend.id]);
    friend.incomingRequests = uniqueStrings([...friend.incomingRequests, user.id]);
    saveUsers(users);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "送出好友邀請失敗" });
  }
});

app.post("/friends/accept", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || req.body?.userId || "").trim();
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    const friend = getUserById(users, friendId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    if (!friend) return res.status(404).json({ error: "找不到好友邀請" });
    if (!user.incomingRequests.includes(friend.id)) return res.status(404).json({ error: "找不到好友邀請" });

    user.incomingRequests = user.incomingRequests.filter((id) => id !== friend.id);
    friend.outgoingRequests = friend.outgoingRequests.filter((id) => id !== user.id);
    user.friends = uniqueStrings([...user.friends, friend.id]);
    friend.friends = uniqueStrings([...friend.friends, user.id]);
    saveUsers(users);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "接受好友邀請失敗" });
  }
});

app.post("/friends/reject", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || req.body?.userId || "").trim();
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    const friend = getUserById(users, friendId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    if (!friend) return res.status(404).json({ error: "找不到好友邀請" });
    if (!user.incomingRequests.includes(friend.id)) return res.status(404).json({ error: "找不到好友邀請" });

    user.incomingRequests = user.incomingRequests.filter((id) => id !== friend.id);
    friend.outgoingRequests = friend.outgoingRequests.filter((id) => id !== user.id);
    saveUsers(users);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "拒絕好友邀請失敗" });
  }
});

app.get("/friends/list", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    const friends = user.friends
      .map((friendId) => getUserById(users, friendId))
      .filter(Boolean)
      .map((friend) => publicFriend(friend, user));
    res.json({ friends });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得好友列表失敗" });
  }
});

app.get("/friends/requests", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    if (!user) return res.status(404).json({ error: "找不到使用者" });
    res.json({
      incoming: user.incomingRequests.map((id) => getUserById(users, id)).filter(Boolean).map(publicUser),
      outgoing: user.outgoingRequests.map((id) => getUserById(users, id)).filter(Boolean).map(publicUser)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得好友邀請失敗" });
  }
});

app.post("/friends/meta", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || "").trim();
    const users = loadUsers();
    const result = requireFriend(req, res, users, friendId);
    if (!result) return;
    const { user } = result;
    user.friendMeta[friendId] = {
      nickname: String(req.body?.nickname || "").trim().slice(0, 80),
      note: String(req.body?.note || "").trim().slice(0, 500)
    };
    saveUsers(users);
    res.json({ success: true, meta: user.friendMeta[friendId] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新好友備註失敗" });
  }
});

app.get("/messages/:friendId", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const result = requireFriend(req, res, users, req.params.friendId);
    if (!result) return;
    const { friend } = result;
    const messages = loadMessages()
      .filter((message) => (
        (message.senderId === req.userId && message.receiverId === friend.id)
        || (message.senderId === friend.id && message.receiverId === req.userId)
      ))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得訊息失敗" });
  }
});

app.post("/messages/send", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || req.body?.receiverId || "").trim();
    const users = loadUsers();
    const result = requireFriend(req, res, users, friendId);
    if (!result) return;
    const content = String(req.body?.content || "").trim();
    const type = req.body?.type === "quick" ? "quick" : "text";
    if (!content) return res.status(400).json({ error: "訊息不可為空" });

    const message = {
      id: createId("m"),
      senderId: req.userId,
      receiverId: friendId,
      type,
      content: content.slice(0, 1000),
      createdAt: new Date().toISOString()
    };
    const messages = loadMessages();
    messages.push(message);
    saveMessages(messages);
    res.json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "送出訊息失敗" });
  }
});

app.post("/tasks/share", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || "").trim();
    const taskId = String(req.body?.taskId || "").trim();
    const users = loadUsers();
    const result = requireFriend(req, res, users, friendId);
    if (!result) return;
    const data = loadUserData(req.userId);
    const task = data.tasks.find((item) => item.id === taskId);
    if (!task) return res.status(404).json({ error: "找不到要分享的任務" });

    const share = {
      id: createId("share"),
      senderId: req.userId,
      receiverId: friendId,
      taskSnapshot: { ...task },
      status: "pending",
      createdAt: new Date().toISOString(),
      respondedAt: ""
    };
    const shares = loadSharedTasks();
    shares.push(share);
    saveSharedTasks(shares);
    res.json({ success: true, share });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "分享任務失敗" });
  }
});

app.get("/tasks/shared/incoming", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const shares = loadSharedTasks()
      .filter((share) => share.receiverId === req.userId && share.status === "pending")
      .map((share) => ({
        ...share,
        sender: publicUser(getUserById(users, share.senderId) || { id: share.senderId, name: "Unknown", email: "" })
      }));
    res.json({ shares });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得共享任務失敗" });
  }
});

app.post("/tasks/shared/accept", authMiddleware, (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    const shares = loadSharedTasks();
    const share = shares.find((item) => item.id === shareId && item.receiverId === req.userId);
    if (!share) return res.status(404).json({ error: "找不到共享任務" });
    if (share.status !== "pending") return res.status(400).json({ error: "這個共享任務已處理" });

    const data = loadUserData(req.userId);
    const taskCopy = {
      ...share.taskSnapshot,
      id: createId("t"),
      status: "todo",
      completedAt: "",
      createdAt: new Date().toISOString()
    };
    data.tasks.push(taskCopy);
    saveUserData(req.userId, data);
    share.status = "accepted";
    share.respondedAt = new Date().toISOString();
    saveSharedTasks(shares);
    res.json({ success: true, task: taskCopy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "接受共享任務失敗" });
  }
});

app.post("/tasks/shared/reject", authMiddleware, (req, res) => {
  try {
    const shareId = String(req.body?.shareId || "").trim();
    const shares = loadSharedTasks();
    const share = shares.find((item) => item.id === shareId && item.receiverId === req.userId);
    if (!share) return res.status(404).json({ error: "找不到共享任務" });
    if (share.status !== "pending") return res.status(400).json({ error: "這個共享任務已處理" });
    share.status = "rejected";
    share.respondedAt = new Date().toISOString();
    saveSharedTasks(shares);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "拒絕共享任務失敗" });
  }
});

app.post("/focus-room/create", authMiddleware, (req, res) => {
  try {
    const friendId = String(req.body?.friendId || "").trim();
    const durationMinutes = Math.max(1, Math.min(240, Number(req.body?.durationMinutes) || 25));
    const users = loadUsers();
    const result = requireFriend(req, res, users, friendId);
    if (!result) return;
    const room = {
      id: createId("room"),
      hostId: req.userId,
      participantIds: [req.userId],
      invitedUserIds: [friendId],
      status: "waiting",
      durationMinutes,
      startedAt: "",
      pausedRemainingSeconds: durationMinutes * 60,
      createdAt: new Date().toISOString(),
      endedAt: ""
    };
    const rooms = loadFocusRooms();
    rooms.push(room);
    saveFocusRooms(rooms);
    res.json({ success: true, room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "建立一起專注房間失敗" });
  }
});

app.post("/focus-room/invite", authMiddleware, (req, res) => {
  try {
    const roomId = String(req.body?.roomId || "").trim();
    const friendId = String(req.body?.friendId || "").trim();
    const users = loadUsers();
    const result = requireFriend(req, res, users, friendId);
    if (!result) return;
    const rooms = loadFocusRooms();
    const room = rooms.find((item) => item.id === roomId);
    if (!room || !canAccessRoom(room, req.userId)) return res.status(404).json({ error: "找不到專注房間" });
    if (room.status === "ended") return res.status(400).json({ error: "專注房間已結束" });
    room.invitedUserIds = uniqueStrings([...(room.invitedUserIds || []), friendId]);
    saveFocusRooms(rooms);
    res.json({ success: true, room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "邀請一起專注失敗" });
  }
});

app.post("/focus-room/join", authMiddleware, (req, res) => {
  try {
    const roomId = String(req.body?.roomId || "").trim();
    const rooms = loadFocusRooms();
    const room = rooms.find((item) => item.id === roomId);
    if (!room || !canAccessRoom(room, req.userId)) return res.status(404).json({ error: "找不到專注房間" });
    if (room.status === "ended") return res.status(400).json({ error: "專注房間已結束" });
    if (!room.invitedUserIds?.includes(req.userId) && !room.participantIds?.includes(req.userId)) {
      return res.status(403).json({ error: "你沒有這個房間的邀請" });
    }
    room.participantIds = uniqueStrings([...(room.participantIds || []), req.userId]);
    room.invitedUserIds = (room.invitedUserIds || []).filter((id) => id !== req.userId);
    saveFocusRooms(rooms);
    res.json({ success: true, room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "加入一起專注失敗" });
  }
});

function mutateFocusRoom(req, res, mutator) {
  try {
    const roomId = String(req.body?.roomId || "").trim();
    const rooms = loadFocusRooms();
    const room = rooms.find((item) => item.id === roomId);
    if (!room || !canAccessRoom(room, req.userId)) return res.status(404).json({ error: "找不到專注房間" });
    if (!room.participantIds?.includes(req.userId)) return res.status(403).json({ error: "請先加入專注房間" });
    mutator(room);
    saveFocusRooms(rooms);
    res.json({ success: true, room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新專注房間失敗" });
  }
}

app.post("/focus-room/start", authMiddleware, (req, res) => {
  mutateFocusRoom(req, res, (room) => {
    if (room.status === "ended") return;
    const remaining = roomRemainingSeconds(room);
    const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
    const startOffset = Math.max(0, total - remaining);
    room.status = "running";
    room.startedAt = new Date(Date.now() - startOffset * 1000).toISOString();
    room.pausedRemainingSeconds = null;
    room.endedAt = "";
  });
});

app.post("/focus-room/pause", authMiddleware, (req, res) => {
  mutateFocusRoom(req, res, (room) => {
    if (room.status !== "running") return;
    room.pausedRemainingSeconds = roomRemainingSeconds(room);
    room.status = "paused";
  });
});

app.post("/focus-room/reset", authMiddleware, (req, res) => {
  mutateFocusRoom(req, res, (room) => {
    const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
    room.status = "waiting";
    room.startedAt = "";
    room.pausedRemainingSeconds = total;
    room.endedAt = "";
  });
});

app.post("/focus-room/end", authMiddleware, (req, res) => {
  mutateFocusRoom(req, res, (room) => {
    room.status = "ended";
    room.pausedRemainingSeconds = 0;
    room.endedAt = new Date().toISOString();
  });
});

app.get("/focus-room/active/:friendId", authMiddleware, (req, res) => {
  try {
    const users = loadUsers();
    const result = requireFriend(req, res, users, req.params.friendId);
    if (!result) return;
    const friendId = result.friend.id;
    const rooms = loadFocusRooms();
    const activeRooms = rooms
      .filter((room) => room.status !== "ended")
      .filter((room) => canAccessRoom(room, req.userId))
      .filter((room) => (
        room.hostId === friendId
        || room.participantIds?.includes(friendId)
        || room.invitedUserIds?.includes(friendId)
      ))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const room = activeRooms[0] || null;

    if (room && room.status === "running" && roomRemainingSeconds(room) <= 0) {
      room.status = "ended";
      room.pausedRemainingSeconds = 0;
      room.endedAt = new Date().toISOString();
      saveFocusRooms(rooms);
    }

    res.json({ room: room ? { ...room, remainingSeconds: roomRemainingSeconds(room) } : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得一起專注房間失敗" });
  }
});

app.post("/ai/plan-day", handleMockAI(buildMockPlanDay));
app.post("/ai/suggest-task", handleMockAI(buildMockSuggestTask));
app.post("/ai/breakdown-task", handleMockAI(buildMockBreakdownTask));
app.post("/ai/analyze", handleMockAI(buildMockAnalyze));

app.listen(PORT, () => {
  console.log(`Focus OS V2 backend running on port ${PORT}`);
});
