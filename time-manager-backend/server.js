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
    focusSessions: [],
    distractions: [],
    settings: {
      focusMinutes: 25,
      breakMinutes: 5
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
      breakMinutes: Math.max(1, Number(value.settings?.breakMinutes) || empty.settings.breakMinutes)
    },
    dailyStats: value.dailyStats && typeof value.dailyStats === "object" ? value.dailyStats : {},
    learningProgress: {
      subjects: Array.isArray(learningProgress.subjects) ? learningProgress.subjects : []
    },
    aiLogs: Array.isArray(value.aiLogs) ? value.aiLogs.slice(0, 50) : []
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

app.post("/ai/plan-day", handleMockAI(buildMockPlanDay));
app.post("/ai/suggest-task", handleMockAI(buildMockSuggestTask));
app.post("/ai/breakdown-task", handleMockAI(buildMockBreakdownTask));
app.post("/ai/analyze", handleMockAI(buildMockAnalyze));

app.listen(PORT, () => {
  console.log(`Focus OS V2 backend running on port ${PORT}`);
});
