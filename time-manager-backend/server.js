const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "PLEASE_CHANGE_THIS_SECRET_KEY";

const DB_DIR = path.join(__dirname, "db");
const USERS_FILE = path.join(DB_DIR, "users.json");
const MESSAGES_FILE = path.join(DB_DIR, "messages.json");
const SHARED_TASKS_FILE = path.join(DB_DIR, "sharedTasks.json");
const FOCUS_ROOMS_FILE = path.join(DB_DIR, "focusRooms.json");
const GROUPS_FILE = path.join(DB_DIR, "groups.json");
const USERDATA_DIR = path.join(DB_DIR, "userdata");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const CHAT_UPLOADS_DIR = path.join(UPLOADS_DIR, "chat");
const THREADS_FILE = path.join(DB_DIR, "threads.json");
const THREAD_REPLIES_FILE = path.join(DB_DIR, "threadReplies.json");

ensureDir(DB_DIR);
ensureDir(USERDATA_DIR);
ensureDir(CHAT_UPLOADS_DIR);
ensureFile(USERS_FILE, []);
ensureFile(MESSAGES_FILE, []);
ensureFile(SHARED_TASKS_FILE, []);
ensureFile(FOCUS_ROOMS_FILE, []);
ensureFile(GROUPS_FILE, []);
ensureFile(THREADS_FILE, []);
ensureFile(THREAD_REPLIES_FILE, []);

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
app.use("/uploads", express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, CHAT_UPLOADS_DIR),
    filename: (_req, file, callback) => {
      const extension = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif"
      }[file.mimetype] || path.extname(file.originalname).toLowerCase();
      callback(null, `${createId("img")}${extension}`);
    }
  }),
  fileFilter: (_req, file, callback) => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedTypes.has(file.mimetype)) {
      callback(new Error("只允許上傳 JPG、PNG、WebP 或 GIF 圖片"));
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

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
    item && typeof item === "object"
      ? {
          ...item,
          nickname: String(item.nickname || "").slice(0, 80),
          note: String(item.note || "").slice(0, 500)
        }
      : { nickname: "", note: "" }
  ]));
}

function normalizeUser(user) {
  const value = user && typeof user === "object" ? user : {};
  return {
    ...value,
    id: value.id,
    name: value.name,
    email: value.email,
    passwordHash: value.passwordHash,
    createdAt: value.createdAt,
    friends: uniqueStrings(value.friends),
    incomingRequests: uniqueStrings(value.incomingRequests),
    outgoingRequests: uniqueStrings(value.outgoingRequests),
    friendMeta: normalizeFriendMeta(value.friendMeta)
  };
}

function loadUsers() {
  const raw = safeReadJSON(USERS_FILE, []);
  const users = Array.isArray(raw) ? raw : [];
  const normalized = users.map(normalizeUser);
  if (JSON.stringify(users) !== JSON.stringify(normalized)) {
    safeWriteJSON(USERS_FILE, normalized);
  }
  return normalized;
}

function saveUsers(users) {
  safeWriteJSON(USERS_FILE, (Array.isArray(users) ? users : []).map(normalizeUser));
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

function getDmRoomId(userIdA, userIdB) {
  return ["dm", ...[userIdA, userIdB].map(String).sort()].join("_");
}

function normalizeMessage(message = {}) {
  const senderId = String(message.senderId || "");
  const receiverId = String(message.receiverId || "");
  const type = ["text", "quick", "image"].includes(message.type) ? message.type : "text";
  return {
    id: message.id || createId("msg"),
    roomId: message.roomId || (senderId && receiverId ? getDmRoomId(senderId, receiverId) : ""),
    senderId,
    receiverId,
    type,
    content: String(message.content || "").slice(0, 1000),
    imageUrl: message.imageUrl || "",
    createdAt: message.createdAt || new Date().toISOString()
  };
}

function loadMessages() {
  const raw = safeReadJSON(MESSAGES_FILE, []);
  const messages = Array.isArray(raw) ? raw : [];
  const normalized = messages.map(normalizeMessage);
  if (JSON.stringify(messages) !== JSON.stringify(normalized)) {
    saveMessages(normalized);
  }
  return normalized;
}

function saveMessages(messages) {
  safeWriteJSON(MESSAGES_FILE, (Array.isArray(messages) ? messages : []).map(normalizeMessage));
}

function getDmMessages(userId, friendId, limit = 100) {
  const roomId = getDmRoomId(userId, friendId);
  return loadMessages()
    .filter((message) => message.roomId === roomId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-limit);
}

function createChatMessage({ senderId, receiverId, type = "text", content = "", imageUrl = "" }) {
  const message = normalizeMessage({
    id: createId("msg"),
    roomId: getDmRoomId(senderId, receiverId),
    senderId,
    receiverId,
    type,
    content,
    imageUrl,
    createdAt: new Date().toISOString()
  });
  const messages = loadMessages();
  messages.push(message);
  saveMessages(messages);
  return message;
}

function getGroupRoomId(groupId) {
  return `group_${groupId}`;
}

function getGroupMessages(groupId, limit = 100) {
  const roomId = getGroupRoomId(groupId);
  return loadMessages()
    .filter((message) => message.roomId === roomId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(-limit);
}

function createGroupMessage({ groupId, senderId, type = "text", content = "", imageUrl = "" }) {
  const message = normalizeMessage({
    id: createId("msg"),
    roomId: getGroupRoomId(groupId),
    senderId,
    receiverId: "", // 群組訊息沒有 receiverId
    type,
    content,
    imageUrl,
    createdAt: new Date().toISOString()
  });
  const messages = loadMessages();
  messages.push(message);
  saveMessages(messages);
  return message;
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

function loadGroups() {
  const raw = safeReadJSON(GROUPS_FILE, []);
  const groups = Array.isArray(raw) ? raw : [];
  const normalized = groups.map(normalizeGroup);
  if (JSON.stringify(groups) !== JSON.stringify(normalized)) {
    safeWriteJSON(GROUPS_FILE, normalized);
  }
  return normalized;
}

function saveGroups(groups) {
  safeWriteJSON(GROUPS_FILE, (Array.isArray(groups) ? groups : []).map(normalizeGroup));
}

function normalizeGroup(group) {
  const value = group && typeof group === "object" ? group : {};
  return {
    id: value.id,
    name: String(value.name || "").trim().slice(0, 40),
    description: String(value.description || "").trim().slice(0, 200),
    ownerId: value.ownerId,
    memberIds: uniqueStrings(value.memberIds),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function normalizeThread(thread) {
  const value = thread && typeof thread === "object" ? thread : {};
  return {
    id: value.id || createId("thread"),
    authorId: String(value.authorId || ""),
    title: String(value.title || "").trim().slice(0, 80),
    content: String(value.content || "").trim().slice(0, 3000),
    subject: String(value.subject || "").trim(),
    tags: uniqueStrings(Array.isArray(value.tags) ? value.tags : String(value.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean)),
    imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls.map(String).slice(0, 4) : [],
    status: value.status === "solved" ? "solved" : "open",
    acceptedReplyId: value.acceptedReplyId || null,
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function normalizeThreadReply(reply) {
  const value = reply && typeof reply === "object" ? reply : {};
  return {
    id: value.id || createId("reply"),
    threadId: String(value.threadId || ""),
    authorId: String(value.authorId || ""),
    content: String(value.content || "").trim().slice(0, 3000),
    imageUrls: Array.isArray(value.imageUrls) ? value.imageUrls.map(String).slice(0, 4) : [],
    createdAt: value.createdAt || new Date().toISOString(),
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function loadThreads() {
  const raw = safeReadJSON(THREADS_FILE, []);
  const threads = Array.isArray(raw) ? raw : [];
  const normalized = threads.map(normalizeThread);
  if (JSON.stringify(threads) !== JSON.stringify(normalized)) {
    safeWriteJSON(THREADS_FILE, normalized);
  }
  return normalized;
}

function saveThreads(threads) {
  safeWriteJSON(THREADS_FILE, (Array.isArray(threads) ? threads : []).map(normalizeThread));
}

function loadThreadReplies() {
  const raw = safeReadJSON(THREAD_REPLIES_FILE, []);
  const replies = Array.isArray(raw) ? raw : [];
  const normalized = replies.map(normalizeThreadReply);
  if (JSON.stringify(replies) !== JSON.stringify(normalized)) {
    safeWriteJSON(THREAD_REPLIES_FILE, normalized);
  }
  return normalized;
}

function saveThreadReplies(replies) {
  safeWriteJSON(THREAD_REPLIES_FILE, (Array.isArray(replies) ? replies : []).map(normalizeThreadReply));
}

function getThreadById(threadId) {
  return loadThreads().find((item) => item.id === String(threadId || ""));
}

function getRepliesByThreadId(threadId) {
  return loadThreadReplies()
    .filter((reply) => reply.threadId === String(threadId || ""))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function buildThreadSummary(thread) {
  const users = loadUsers();
  return {
    id: thread.id,
    author: publicUser(getUserById(users, thread.authorId) || { id: thread.authorId, name: "Unknown", email: "" }),
    title: thread.title,
    content: thread.content,
    subject: thread.subject,
    tags: thread.tags,
    imageUrls: thread.imageUrls,
    status: thread.status,
    acceptedReplyId: thread.acceptedReplyId,
    replyCount: getRepliesByThreadId(thread.id).length,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt
  };
}

function buildThreadDetail(thread) {
  const users = loadUsers();
  const author = publicUser(getUserById(users, thread.authorId) || { id: thread.authorId, name: "Unknown", email: "" });
  const replies = getRepliesByThreadId(thread.id).map((reply) => ({
    ...reply,
    author: publicUser(getUserById(users, reply.authorId) || { id: reply.authorId, name: "Unknown", email: "" })
  }));

  return {
    ...thread,
    author,
    replies
  };
}

function parseThreadTags(rawTags) {
  return uniqueStrings(String(rawTags || "").split(",").map((tag) => tag.trim()).filter(Boolean));
}

function threadUploadErrorMessage(uploadErr) {
  if (!uploadErr) return null;
  if (uploadErr.code === "LIMIT_FILE_SIZE") return "圖片大小不可超過 10MB";
  if (uploadErr.code === "LIMIT_UNEXPECTED_FILE") return "最多只能上傳 4 張圖片";
  return uploadErr.message || "圖片上傳失敗";
}

function removeUploadedFiles(files) {
  (Array.isArray(files) ? files : []).forEach((file) => {
    if (file?.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
  });
}

function collectThreadImageUrls(files) {
  return (Array.isArray(files) ? files : []).slice(0, 4).map((file) => `/uploads/chat/${file.filename}`);
}

function validateThreadStatus(status) {
  return status === "open" || status === "solved";
}

function publicUserSafe(user) {
  return publicUser(user);
}

function getThreadAuthor(thread) {
  const users = loadUsers();
  return getUserById(users, thread.authorId) || { id: thread.authorId, name: "Unknown", email: "" };
}

function buildThreadResponse(thread) {
  const author = publicUserSafe(getThreadAuthor(thread));
  const replyCount = getRepliesByThreadId(thread.id).length;
  return { ...thread, author, replyCount };
}

function buildThreadDetailResponse(thread) {
  const author = publicUserSafe(getThreadAuthor(thread));
  const replies = getRepliesByThreadId(thread.id).map((reply) => ({
    ...reply,
    author: publicUserSafe(getUserById(loadUsers(), reply.authorId) || { id: reply.authorId, name: "Unknown", email: "" })
  }));
  return { ...thread, author, replies };
}

function normalizeThreadFields(fields) {
  return {
    title: String(fields.title || "").trim().slice(0, 80),
    content: String(fields.content || "").trim().slice(0, 3000),
    subject: String(fields.subject || "").trim(),
    tags: parseThreadTags(fields.tags),
    imageUrls: collectThreadImageUrls(fields.files)
  };
}

function isThreadOwner(thread, userId) {
  return thread.authorId === String(userId || "");
}

function parseThreadBodyString(value) {
  return String(value || "").trim();
}

function filterThreadsByQuery(threads, query) {
  const subject = String(query.subject || "").trim().toLowerCase();
  const status = String(query.status || "").trim().toLowerCase();
  const q = String(query.q || "").trim().toLowerCase();
  const tag = String(query.tag || "").trim().toLowerCase();

  return threads.filter((thread) => {
    if (subject && String(thread.subject || "").toLowerCase() !== subject) return false;
    if (status && String(thread.status || "").toLowerCase() !== status) return false;
    if (tag && !thread.tags.some((item) => String(item || "").toLowerCase() === tag)) return false;
    if (q) {
      const title = String(thread.title || "").toLowerCase();
      const content = String(thread.content || "").toLowerCase();
      if (!title.includes(q) && !content.includes(q)) return false;
    }
    return true;
  });
}

function cleanupThreadFiles(files) {
  removeUploadedFiles(files);
}

function handleThreadUploadArray(fieldName, maxCount) {
  return (req, res, next) => {
    upload.array(fieldName, maxCount)(req, res, (uploadErr) => {
      if (uploadErr) {
        const message = threadUploadErrorMessage(uploadErr);
        cleanupThreadFiles(req.files);
        return res.status(400).json({ error: message });
      }
      next();
    });
  };
}

function validateThreadPayload(req, res) {
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  if (!title || title.length > 80) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "標題長度需為 1~80 字" });
    return false;
  }
  if (!content || content.length > 3000) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "內容長度需為 1~3000 字" });
    return false;
  }
  return true;
}

function validateReplyPayload(req, res) {
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 3000) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "回覆內容長度需為 1~3000 字" });
    return false;
  }
  return true;
}

function sanitizeTags(rawTags) {
  return parseThreadTags(rawTags).slice(0, 20);
}

function threadCreatePayload(req) {
  return {
    title: String(req.body?.title || "").trim().slice(0, 80),
    content: String(req.body?.content || "").trim().slice(0, 3000),
    subject: String(req.body?.subject || "").trim(),
    tags: sanitizeTags(req.body?.tags),
    imageUrls: collectThreadImageUrls(req.files)
  };
}

function replyCreatePayload(req, threadId) {
  return {
    threadId: String(threadId || ""),
    authorId: req.userId,
    content: String(req.body?.content || "").trim().slice(0, 3000),
    imageUrls: collectThreadImageUrls(req.files)
  };
}

function createThreadResponse(thread) {
  const author = publicUserSafe(getThreadAuthor(thread));
  const replyCount = getRepliesByThreadId(thread.id).length;
  return { ...thread, author, replyCount };
}


function publicThread(thread) {
  return createThreadResponse(thread);
}

function publicThreadDetail(thread) {
  return buildThreadDetailResponse(thread);
}

function parseThreadStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return status === "solved" ? "solved" : (status === "open" ? "open" : null);
}

function loadRepliesFromThread(thread) {
  return getRepliesByThreadId(thread.id);
}

function getReplyById(replyId) {
  return loadThreadReplies().find((reply) => reply.id === String(replyId || ""));
}

function replyBelongsToThread(reply, threadId) {
  return reply && String(reply.threadId) === String(threadId || "");
}

function createNewThread(data) {
  const threads = loadThreads();
  const thread = normalizeThread({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  threads.push(thread);
  saveThreads(threads);
  return thread;
}

function createNewReply(data) {
  const replies = loadThreadReplies();
  const reply = normalizeThreadReply({ ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  replies.push(reply);
  saveThreadReplies(replies);
  return reply;
}

function buildThreadListResponse(threads) {
  return threads.map(publicThread);
}

function updateThread(thread, updates) {
  const threads = loadThreads();
  const target = threads.find((item) => item.id === thread.id);
  if (!target) return null;
  Object.assign(target, updates, { updatedAt: new Date().toISOString() });
  saveThreads(threads);
  return target;
}

function threadExists(threadId) {
  return Boolean(getThreadById(threadId));
}

function replyExistsInThread(threadId, replyId) {
  return Boolean(getThreadById(threadId) && getReplyById(replyId) && replyBelongsToThread(getReplyById(replyId), threadId));
}

function getThreadPublicAuthor(thread) {
  return publicUserSafe(getThreadAuthor(thread));
}

function getThreadDetailData(threadId) {
  const thread = getThreadById(threadId);
  return thread ? buildThreadDetailResponse(thread) : null;
}

function isValidThreadStatus(status) {
  return status === "open" || status === "solved";
}

function updateThreadStatus(thread, status) {
  thread.status = status;
  thread.updatedAt = new Date().toISOString();
  saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
  return thread;
}

function updateThreadAcceptedReply(thread, replyId) {
  thread.acceptedReplyId = String(replyId || "");
  thread.status = "solved";
  thread.updatedAt = new Date().toISOString();
  saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
  return thread;
}

function getThreadAuthorPublic(thread) {
  return publicUserSafe(getThreadAuthor(thread));
}

function threadListFromQuery(query) {
  return buildThreadListResponse(filterThreadsByQuery(loadThreads(), query));
}

function validateThreadCount(files) {
  return (Array.isArray(files) ? files.length : 0) <= 4;
}

function validateReplyCount(files) {
  return (Array.isArray(files) ? files.length : 0) <= 4;
}

function buildThreadReplyResponse(reply) {
  const users = loadUsers();
  return { ...reply, author: publicUserSafe(getUserById(users, reply.authorId) || { id: reply.authorId, name: "Unknown", email: "" }) };
}

function buildThreadRepliesResponse(replies) {
  return replies.map(buildThreadReplyResponse);
}

function sanitizeThreadAuthorFields(thread) {
  return {
    ...thread,
    author: publicUserSafe(getThreadAuthor(thread))
  };
}

function getThreadListResult(query) {
  return buildThreadListResponse(filterThreadsByQuery(loadThreads(), query).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
}

function getThreadRepliesResult(threadId) {
  return buildThreadRepliesResponse(getRepliesByThreadId(threadId));
}

function ensureThreadFiles() {
  ensureFile(THREADS_FILE, []);
  ensureFile(THREAD_REPLIES_FILE, []);
}

function createThreadObject(fields) {
  return normalizeThread({
    authorId: fields.authorId,
    title: fields.title,
    content: fields.content,
    subject: fields.subject,
    tags: fields.tags,
    imageUrls: fields.imageUrls,
    status: "open",
    acceptedReplyId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function createReplyObject(fields) {
  return normalizeThreadReply({
    threadId: fields.threadId,
    authorId: fields.authorId,
    content: fields.content,
    imageUrls: fields.imageUrls,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function threadAuthorFromThread(thread) {
  return getThreadAuthor(thread);
}

function isThreadAuthor(thread, userId) {
  return String(thread.authorId) === String(userId);
}

function errorIfNoThread(res, thread) {
  if (!thread) {
    res.status(404).json({ error: "找不到討論串" });
    return true;
  }
  return false;
}

function errorIfNotAuthor(res, thread, userId) {
  if (!isThreadAuthor(thread, userId)) {
    res.status(403).json({ error: "只有作者可以執行此操作" });
    return true;
  }
  return false;
}

function getThreadQueryFilters(query) {
  return filterThreadsByQuery(loadThreads(), query);
}

function resolveThreadImageUrls(files) {
  return collectThreadImageUrls(files);
}

function threadFilters(query) {
  return filterThreadsByQuery(loadThreads(), query);
}

function createThreadId() {
  return createId("th");
}

function createReplyId() {
  return createId("rep");
}

function validateFieldsString(value) {
  return String(value || "").trim();
}

function threadPayload(req) {
  return {
    title: validateFieldsString(req.body?.title).slice(0, 80),
    content: validateFieldsString(req.body?.content).slice(0, 3000),
    subject: validateFieldsString(req.body?.subject),
    tags: sanitizeTags(req.body?.tags),
    imageUrls: resolveThreadImageUrls(req.files)
  };
}

function replyPayload(req, threadId) {
  return {
    threadId: String(threadId || ""),
    authorId: req.userId,
    content: validateFieldsString(req.body?.content).slice(0, 3000),
    imageUrls: resolveThreadImageUrls(req.files)
  };
}

function getThreadWithAuthor(thread) {
  return buildThreadResponse(thread);
}

function getThreadDetailWithAuthor(thread) {
  return buildThreadDetailResponse(thread);
}

function canUseThreadUpload(files) {
  return validateThreadCount(files);
}

function canUseReplyUpload(files) {
  return validateReplyCount(files);
}

function buildThreadList(threads) {
  return threads.map((thread) => buildThreadResponse(thread));
}

function threadSearch(query) {
  return getThreadListResult(query);
}

function loadAllThreads() {
  return loadThreads();
}

function loadAllReplies() {
  return loadThreadReplies();
}

function getThreadCount() {
  return loadThreads().length;
}

function getReplyCount(threadId) {
  return getRepliesByThreadId(threadId).length;
}

function createThreadReply(threadId, userId, content, imageUrls) {
  const reply = normalizeThreadReply({ threadId, authorId: userId, content, imageUrls, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const replies = loadThreadReplies();
  replies.push(reply);
  saveThreadReplies(replies);
  return reply;
}

function saveThread(thread) {
  const threads = loadThreads();
  const index = threads.findIndex((item) => item.id === thread.id);
  if (index === -1) {
    threads.push(thread);
  } else {
    threads[index] = thread;
  }
  saveThreads(threads);
  return thread;
}

function updateThreadById(threadId, updates) {
  const threads = loadThreads();
  const thread = threads.find((item) => item.id === String(threadId || ""));
  if (!thread) return null;
  Object.assign(thread, updates, { updatedAt: new Date().toISOString() });
  saveThreads(threads);
  return thread;
}

function removeInvalidThreadFiles(files) {
  removeUploadedFiles(files);
}

function createThreadWithAuthor(req) {
  return createThreadObject(threadPayload(req));
}

function createReplyForThread(req, threadId) {
  return createReplyObject(replyPayload(req, threadId));
}

function addReplyToThread(req, threadId) {
  const reply = createReplyForThread(req, threadId);
  const replies = loadThreadReplies();
  replies.push(reply);
  saveThreadReplies(replies);
  return reply;
}

function threadHasAuthor(thread, userId) {
  return String(thread.authorId) === String(userId);
}

function threadCanBeClosed(thread, userId) {
  return threadHasAuthor(thread, userId);
}

function threadCanAcceptReply(thread, userId) {
  return threadHasAuthor(thread, userId);
}

function threadUpdateStatus(thread, status) {
  thread.status = status;
  thread.updatedAt = new Date().toISOString();
  saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
  return thread;
}

function threadMarkAcceptedReply(thread, replyId) {
  thread.acceptedReplyId = String(replyId || "");
  thread.status = "solved";
  thread.updatedAt = new Date().toISOString();
  saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
  return thread;
}

function getThreadWithReplies(threadId) {
  const thread = getThreadById(threadId);
  if (!thread) return null;
  return buildThreadDetailResponse(thread);
}

function threadListForClient(query) {
  return buildThreadList(filterThreadsByQuery(loadThreads(), query).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
}

function createReplyObjectFromReq(req, threadId) {
  return normalizeThreadReply({
    threadId: String(threadId || ""),
    authorId: req.userId,
    content: String(req.body?.content || "").trim().slice(0, 3000),
    imageUrls: collectThreadImageUrls(req.files),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

function loadThreadAuthor(thread) {
  return getUserById(loadUsers(), thread.authorId) || { id: thread.authorId, name: "Unknown", email: "" };
}

function threadPublic(thread) {
  return { ...thread, author: publicUserSafe(loadThreadAuthor(thread)) };
}

function replyPublic(reply) {
  return { ...reply, author: publicUserSafe(getUserById(loadUsers(), reply.authorId) || { id: reply.authorId, name: "Unknown", email: "" }) };
}

function threadListResponse(query) {
  return loadThreads()
    .filter((thread) => filterThreadsByQuery([thread], query).length)
    .map((thread) => threadPublic(thread));
}

function threadMatches(thread, query) {
  return filterThreadsByQuery([thread], query).length > 0;
}

function loadThreadAndReplies(threadId) {
  const thread = getThreadById(threadId);
  if (!thread) return null;
  return { thread, replies: getRepliesByThreadId(thread.id) };
}

function threadList(query) {
  return buildThreadList(filterThreadsByQuery(loadThreads(), query).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))));
}

function createThreadReplyRecord(req, threadId) {
  return createReplyObjectFromReq(req, threadId);
}

function saveReply(reply) {
  const replies = loadThreadReplies();
  const index = replies.findIndex((item) => item.id === reply.id);
  if (index === -1) {
    replies.push(reply);
  } else {
    replies[index] = reply;
  }
  saveThreadReplies(replies);
  return reply;
}

function threadReplyList(threadId) {
  return getRepliesByThreadId(threadId).map(replyPublic);
}

function threadSummary(thread) {
  return publicThread(thread);
}

function threadDetail(threadId) {
  return getThreadDetailWithAuthor(getThreadById(threadId));
}

function ensureThreadData() {
  ensureFile(THREADS_FILE, []);
  ensureFile(THREAD_REPLIES_FILE, []);
}

function threadRoutesRegistered() {
  return true;
}

function normalizePostedTags(body) {
  return sanitizeTags(body?.tags);
}

function getThreadOr404(res, threadId) {
  const thread = getThreadById(threadId);
  if (!thread) {
    res.status(404).json({ error: "找不到討論串" });
    return null;
  }
  return thread;
}

function isThreadOwnerOrError(res, thread, userId) {
  if (!thread) return false;
  if (!isThreadOwner(thread, userId)) {
    res.status(403).json({ error: "只有作者可以執行此操作" });
    return false;
  }
  return true;
}

function getThreadList(query) {
  const threads = filterThreadsByQuery(loadThreads(), query).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return threads.map(publicThread);
}

function getThreadDetailObject(threadId) {
  const thread = getThreadById(threadId);
  if (!thread) return null;
  return { ...thread, author: publicUserSafe(getThreadById(loadUsers(), thread.authorId) || { id: thread.authorId, name: "Unknown", email: "" }), replies: threadReplyList(thread.id) };
}

function threadPayloadFromBody(body) {
  return {
    title: String(body?.title || "").trim().slice(0, 80),
    content: String(body?.content || "").trim().slice(0, 3000),
    subject: String(body?.subject || "").trim(),
    tags: sanitizeTags(body?.tags)
  };
}

function safeThreadField(value) {
  return String(value || "").trim();
}

function getThreadAuthorPublic(thread) {
  return publicUserSafe(getThreadAuthor(thread));
}

function threadDataResponse(thread) {
  return { ...thread, author: getThreadAuthorPublic(thread), replyCount: getRepliesByThreadId(thread.id).length };
}

function threadDetailDataResponse(thread) {
  return buildThreadDetailResponse(thread);
}

function getThreadListPayload(query) {
  return threadList(query);
}

function getThreadDetailPayload(threadId) {
  return threadDetail(threadId);
}

function getThreadListView(query) {
  return threadList(query);
}

function getThreadDetailView(threadId) {
  return threadDetail(threadId);
}

function createReplyForThreadId(threadId, req) {
  const reply = createReplyObjectFromReq(req, threadId);
  saveReply(reply);
  return reply;
}

function threadOwnerCheck(thread, userId) {
  return thread.authorId === String(userId);
}

function validateThreadOwner(thread, userId, res) {
  if (!threadOwnerCheck(thread, userId)) {
    res.status(403).json({ error: "只有作者可以執行此操作" });
    return false;
  }
  return true;
}

function threadOwnerOrError(thread, userId, res) {
  return validateThreadOwner(thread, userId, res);
}

function getThreadResponse(thread) {
  return publicThread(thread);
}

function getThreadDetailResponse(thread) {
  return publicThreadDetail(thread);
}

function createThreadResponseBody(thread) {
  return publicThread(thread);
}

function createReplyResponseBody(reply) {
  return buildThreadReplyResponse(reply);
}

function buildPublicThread(thread) {
  return publicThread(thread);
}

function buildPublicReply(reply) {
  return buildThreadReplyResponse(reply);
}

function serializeThread(thread) {
  return publicThread(thread);
}

function serializeReply(reply) {
  return buildThreadReplyResponse(reply);
}

function validateThreadSubmission(req, res) {
  const title = String(req.body?.title || "").trim();
  const content = String(req.body?.content || "").trim();
  if (!title || title.length > 80) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "標題長度需為 1~80 字" });
    return false;
  }
  if (!content || content.length > 3000) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "內容長度需為 1~3000 字" });
    return false;
  }
  return true;
}

function validateReplySubmission(req, res) {
  const content = String(req.body?.content || "").trim();
  if (!content || content.length > 3000) {
    cleanupThreadFiles(req.files);
    res.status(400).json({ error: "回覆內容需為 1~3000 字" });
    return false;
  }
  return true;
}

function attachThreadRoutes() {
  app.get("/threads", (req, res) => {
    try {
      const threads = filterThreadsByQuery(loadThreads(), req.query).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      res.json({ threads: threads.map(publicThread) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "讀取討論串列表失敗" });
    }
  });

  app.post("/threads/create", authMiddleware, (req, res) => {
    upload.array("images", 4)(req, res, (uploadErr) => {
      try {
        if (uploadErr) {
          const message = threadUploadErrorMessage(uploadErr);
          return res.status(400).json({ error: message });
        }
        if (!validateThreadSubmission(req, res)) return;
        const thread = normalizeThread({
          authorId: req.userId,
          title: String(req.body?.title || "").trim(),
          content: String(req.body?.content || "").trim(),
          subject: String(req.body?.subject || "").trim(),
          tags: sanitizeTags(req.body?.tags),
          imageUrls: collectThreadImageUrls(req.files),
          status: "open",
          acceptedReplyId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        const threads = loadThreads();
        threads.push(thread);
        saveThreads(threads);
        res.json({ success: true, thread: publicThread(thread) });
      } catch (err) {
        cleanupThreadFiles(req.files);
        console.error(err);
        res.status(500).json({ error: "建立討論串失敗" });
      }
    });
  });

  app.get("/threads/:threadId", (req, res) => {
    try {
      const thread = getThreadById(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "找不到討論串" });
      res.json({ thread: publicThreadDetail(thread) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "讀取討論串失敗" });
    }
  });

  app.post("/threads/:threadId/reply", authMiddleware, (req, res) => {
    upload.array("images", 4)(req, res, (uploadErr) => {
      try {
        if (uploadErr) {
          const message = threadUploadErrorMessage(uploadErr);
          return res.status(400).json({ error: message });
        }
        if (!validateReplySubmission(req, res)) return;
        const thread = getThreadById(req.params.threadId);
        if (!thread) {
          cleanupThreadFiles(req.files);
          return res.status(404).json({ error: "找不到討論串" });
        }
        const reply = normalizeThreadReply({
          threadId: thread.id,
          authorId: req.userId,
          content: String(req.body?.content || "").trim(),
          imageUrls: collectThreadImageUrls(req.files),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        const replies = loadThreadReplies();
        replies.push(reply);
        saveThreadReplies(replies);
        res.json({ success: true, reply: buildThreadReplyResponse(reply) });
      } catch (err) {
        cleanupThreadFiles(req.files);
        console.error(err);
        res.status(500).json({ error: "回覆討論串失敗" });
      }
    });
  });

  app.post("/threads/:threadId/accept-reply", authMiddleware, (req, res) => {
    try {
      const thread = getThreadById(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "找不到討論串" });
      if (!isThreadOwner(thread, req.userId)) return res.status(403).json({ error: "只有討論串作者可以標記最佳解答" });
      const replyId = String(req.body?.replyId || "").trim();
      if (!replyId) return res.status(400).json({ error: "請提供 replyId" });
      const reply = getReplyById(replyId);
      if (!reply || reply.threadId !== thread.id) return res.status(404).json({ error: "找不到回覆" });
      thread.acceptedReplyId = reply.id;
      thread.status = "solved";
      thread.updatedAt = new Date().toISOString();
      saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
      res.json({ success: true, thread: publicThread(thread) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "標記最佳解答失敗" });
    }
  });

  app.post("/threads/:threadId/close", authMiddleware, (req, res) => {
    try {
      const thread = getThreadById(req.params.threadId);
      if (!thread) return res.status(404).json({ error: "找不到討論串" });
      if (!isThreadOwner(thread, req.userId)) return res.status(403).json({ error: "只有討論串作者可以關閉或重新開啟" });
      const requestedStatus = parseThreadStatus(req.body?.status);
      if (requestedStatus) {
        thread.status = requestedStatus;
      } else {
        thread.status = thread.status === "solved" ? "open" : "solved";
      }
      thread.updatedAt = new Date().toISOString();
      saveThreads(loadThreads().map((item) => item.id === thread.id ? thread : item));
      res.json({ success: true, thread: publicThread(thread) });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "關閉或開啟討論串失敗" });
    }
  });
});

attachThreadRoutes();

function publicGroup(group, currentUserId) {
  const users = loadUsers();
  const members = group.memberIds.map((id) => getUserById(users, id)).filter(Boolean).map(publicUser);
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    ownerId: group.ownerId,
    memberIds: group.memberIds,
    members,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    isOwner: group.ownerId === currentUserId
  };
}

function isGroupMember(group, userId) {
  return group.memberIds.includes(userId);
}

function getGroupById(groupId) {
  return loadGroups().find((group) => group.id === groupId);
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
    friendMeta: meta,
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
    res.json({ messages: getDmMessages(req.userId, friend.id, 100) });
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

    const message = createChatMessage({
      senderId: req.userId,
      receiverId: friendId,
      type,
      content: content.slice(0, 1000)
    });
    emitChatMessage(message);
    res.json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "送出訊息失敗" });
  }
});

app.post("/messages/upload-image", authMiddleware, (req, res) => {
  upload.single("image")(req, res, (uploadErr) => {
    try {
      if (uploadErr) {
        const message = uploadErr.code === "LIMIT_FILE_SIZE" ? "圖片大小不可超過 10MB" : uploadErr.message;
        return res.status(400).json({ error: message });
      }
      const friendId = String(req.body?.friendId || "").trim();
      const users = loadUsers();
      const result = requireFriend(req, res, users, friendId);
      if (!result) {
        if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return;
      }
      if (!req.file) return res.status(400).json({ error: "請選擇圖片" });

      const imageUrl = `/uploads/chat/${req.file.filename}`;
      const message = createChatMessage({
        senderId: req.userId,
        receiverId: friendId,
        type: "image",
        content: String(req.body?.content || "").trim().slice(0, 1000),
        imageUrl
      });
      emitChatMessage(message);
      res.json({ success: true, message });
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error(err);
      res.status(500).json({ error: "圖片上傳失敗" });
    }
  });
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

app.post("/groups/create", authMiddleware, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (!name || name.length > 40) return res.status(400).json({ error: "群組名稱長度需為 1~40 字元" });
    if (description.length > 200) return res.status(400).json({ error: "群組描述長度不可超過 200 字元" });

    const group = {
      id: createId("group"),
      name,
      description,
      ownerId: req.userId,
      memberIds: [req.userId],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const groups = loadGroups();
    groups.push(group);
    saveGroups(groups);
    res.json({ success: true, group: publicGroup(group, req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "建立群組失敗" });
  }
});

app.get("/groups/list", authMiddleware, (req, res) => {
  try {
    const groups = loadGroups().filter((group) => isGroupMember(group, req.userId));
    res.json({ groups: groups.map((group) => publicGroup(group, req.userId)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組列表失敗" });
  }
});

app.get("/groups/:groupId", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!isGroupMember(group, req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });
    res.json({ group: publicGroup(group, req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組資料失敗" });
  }
});

app.post("/groups/:groupId/invite", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!isGroupMember(group, req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    const friendId = String(req.body?.friendId || "").trim();
    const users = loadUsers();
    const user = getUserById(users, req.userId);
    const friend = getUserById(users, friendId);
    if (!friend) return res.status(404).json({ error: "找不到好友" });
    if (!areFriends(user, friend.id)) return res.status(403).json({ error: "只能邀請好友加入群組" });
    if (isGroupMember(group, friend.id)) return res.status(400).json({ error: "這個好友已經在群組中" });

    group.memberIds = uniqueStrings([...group.memberIds, friend.id]);
    group.updatedAt = new Date().toISOString();
    saveGroups(loadGroups().map((g) => g.id === group.id ? group : g));
    res.json({ success: true, group: publicGroup(group, req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "邀請好友加入群組失敗" });
  }
});

app.post("/groups/:groupId/leave", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!isGroupMember(group, req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    const groups = loadGroups();
    if (group.ownerId === req.userId) {
      const remainingMembers = group.memberIds.filter((id) => id !== req.userId);
      if (remainingMembers.length > 0) {
        group.ownerId = remainingMembers[0];
        group.memberIds = remainingMembers;
        group.updatedAt = new Date().toISOString();
        saveGroups(groups.map((g) => g.id === group.id ? group : g));
      } else {
        saveGroups(groups.filter((g) => g.id !== group.id));
      }
    } else {
      group.memberIds = group.memberIds.filter((id) => id !== req.userId);
      group.updatedAt = new Date().toISOString();
      saveGroups(groups.map((g) => g.id === group.id ? group : g));
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "離開群組失敗" });
  }
});

app.post("/groups/:groupId/update", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (group.ownerId !== req.userId) return res.status(403).json({ error: "只有群組擁有者可以修改群組" });

    const name = String(req.body?.name || "").trim();
    const description = String(req.body?.description || "").trim();
    if (!name || name.length > 40) return res.status(400).json({ error: "群組名稱長度需為 1~40 字元" });
    if (description.length > 200) return res.status(400).json({ error: "群組描述長度不可超過 200 字元" });

    group.name = name;
    group.description = description;
    group.updatedAt = new Date().toISOString();
    saveGroups(loadGroups().map((g) => g.id === group.id ? group : g));
    res.json({ success: true, group: publicGroup(group, req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新群組失敗" });
  }
});

app.get("/groups/:groupId/messages", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!isGroupMember(group, req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    const messages = getGroupMessages(req.params.groupId, 100);
    res.json({ messages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得群組訊息失敗" });
  }
});

app.post("/groups/:groupId/upload-image", authMiddleware, upload.single("image"), (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (!isGroupMember(group, req.userId)) return res.status(403).json({ error: "你不是這個群組的成員" });

    if (!req.file) return res.status(400).json({ error: "沒有上傳圖片" });

    const imageUrl = `/uploads/chat/${req.file.filename}`;
    const message = createGroupMessage({
      groupId: req.params.groupId,
      senderId: req.userId,
      type: "image",
      content: "",
      imageUrl
    });

    if (typeof io !== "undefined") {
      io.to(message.roomId).emit("message:new", message);
    }

    res.json({ success: true, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "上傳圖片失敗" });
  }
});

app.post("/groups/:groupId/remove-member", authMiddleware, (req, res) => {
  try {
    const group = getGroupById(req.params.groupId);
    if (!group) return res.status(404).json({ error: "找不到群組" });
    if (group.ownerId !== req.userId) return res.status(403).json({ error: "只有群組擁有者可以移除成員" });

    const memberId = String(req.body?.memberId || "").trim();
    if (memberId === req.userId) return res.status(400).json({ error: "擁有者不能移除自己" });
    if (!isGroupMember(group, memberId)) return res.status(404).json({ error: "這個使用者不是群組成員" });

    group.memberIds = group.memberIds.filter((id) => id !== memberId);
    group.updatedAt = new Date().toISOString();
    saveGroups(loadGroups().map((g) => g.id === group.id ? group : g));
    res.json({ success: true, group: publicGroup(group, req.userId) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "移除群組成員失敗" });
  }
});

app.post("/ai/plan-day", handleMockAI(buildMockPlanDay));
app.post("/ai/suggest-task", handleMockAI(buildMockSuggestTask));
app.post("/ai/breakdown-task", handleMockAI(buildMockBreakdownTask));
app.post("/ai/analyze", handleMockAI(buildMockAnalyze));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length ? allowedOrigins : true,
    methods: ["GET", "POST"]
  }
});
const onlineUsers = new Map();

function addOnlineSocket(userId, socketId) {
  const sockets = onlineUsers.get(userId) || new Set();
  sockets.add(socketId);
  onlineUsers.set(userId, sockets);
}

function removeOnlineSocket(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size) {
    onlineUsers.set(userId, sockets);
    return true;
  }
  onlineUsers.delete(userId);
  return false;
}

function requireSocketFriend(socket, friendId) {
  const users = loadUsers();
  const user = getUserById(users, socket.userId);
  const friend = getUserById(users, friendId);
  if (!user || !friend || !areFriends(user, friend.id)) return null;
  return { user, friend };
}

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("請先登入"));
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = getUserById(loadUsers(), decoded.id);
    if (!user) return next(new Error("找不到使用者"));
    socket.userId = decoded.id;
    next();
  } catch (_) {
    next(new Error("登入狀態已失效，請重新登入"));
  }
});

io.on("connection", (socket) => {
  addOnlineSocket(socket.userId, socket.id);
  Array.from(onlineUsers.keys()).forEach((userId) => {
    socket.emit("presence:update", { userId, online: true });
  });
  io.emit("presence:update", { userId: socket.userId, online: true });

  socket.on("join:dm", ({ friendId } = {}) => {
    const result = requireSocketFriend(socket, String(friendId || ""));
    if (!result) {
      socket.emit("chat:error", { error: "只能與好友聊天" });
      return;
    }
    const roomId = getDmRoomId(socket.userId, result.friend.id);
    socket.join(roomId);
    socket.emit("messages:history", getDmMessages(socket.userId, result.friend.id, 50));
  });

  socket.on("message:send", ({ friendId, content, type = "text" } = {}) => {
    const result = requireSocketFriend(socket, String(friendId || ""));
    if (!result) {
      socket.emit("chat:error", { error: "只能傳訊息給好友" });
      return;
    }
    const text = String(content || "").trim().slice(0, 1000);
    if (!text) return;
    const message = createChatMessage({
      senderId: socket.userId,
      receiverId: result.friend.id,
      type: type === "quick" ? "quick" : "text",
      content: text
    });
    io.to(message.roomId).emit("message:new", message);
  });

  socket.on("typing:start", ({ friendId } = {}) => {
    const result = requireSocketFriend(socket, String(friendId || ""));
    if (!result) return;
    const roomId = getDmRoomId(socket.userId, result.friend.id);
    socket.to(roomId).emit("typing:update", { userId: socket.userId, typing: true });
  });

  socket.on("join:group", ({ groupId } = {}) => {
    const group = getGroupById(String(groupId || ""));
    if (!group) {
      socket.emit("chat:error", { error: "找不到群組" });
      return;
    }
    if (!isGroupMember(group, socket.userId)) {
      socket.emit("chat:error", { error: "你不是這個群組的成員" });
      return;
    }
    const roomId = getGroupRoomId(groupId);
    socket.join(roomId);
    socket.emit("messages:history", getGroupMessages(groupId, 100));
  });

  socket.on("group:message:send", ({ groupId, content, type = "text" } = {}) => {
    const group = getGroupById(String(groupId || ""));
    if (!group) {
      socket.emit("chat:error", { error: "找不到群組" });
      return;
    }
    if (!isGroupMember(group, socket.userId)) {
      socket.emit("chat:error", { error: "你不是這個群組的成員" });
      return;
    }
    const text = String(content || "").trim().slice(0, 1000);
    if (!text) return;
    const message = createGroupMessage({
      groupId,
      senderId: socket.userId,
      type: type === "quick" ? "quick" : "text",
      content: text
    });
    io.to(message.roomId).emit("message:new", message);
  });

  socket.on("disconnect", () => {
    const stillOnline = removeOnlineSocket(socket.userId, socket.id);
    if (!stillOnline) io.emit("presence:update", { userId: socket.userId, online: false });
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
