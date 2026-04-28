const express = require("express");
const mongoose = require("mongoose");
const { User, publicUser } = require("../models/User");
const Thread = require("../models/Thread");
const ThreadReply = require("../models/ThreadReply");
const { threadImagesUpload } = require("../middleware/uploadMiddleware");

const router = express.Router();

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  if (typeof rawTags === "string") {
    try {
      const parsed = JSON.parse(rawTags);
      if (Array.isArray(parsed)) return parsed.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
    } catch (_) {}
    return String(rawTags || "").split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 20);
  }
  return [];
}

function formatThread(thread) {
  const obj = typeof thread.toObject === "function" ? thread.toObject() : thread;
  return {
    ...obj,
    id: String(obj._id || obj.id),
    authorId: obj.authorId ? String(obj.authorId) : null,
    acceptedReplyId: obj.acceptedReplyId ? String(obj.acceptedReplyId) : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

function formatReply(reply) {
  const obj = typeof reply.toObject === "function" ? reply.toObject() : reply;
  return {
    ...obj,
    id: String(obj._id || obj.id),
    authorId: obj.authorId ? String(obj.authorId) : null,
    threadId: obj.threadId ? String(obj.threadId) : null,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
}

router.get("/", async (req, res) => {
  try {
    const query = req.query || {};
    const filter = {};
    if (query.status) filter.status = String(query.status).trim();
    if (query.subject) filter.subject = String(query.subject).trim();
    if (query.tag) filter.tags = String(query.tag).trim();
    if (query.q) {
      const q = String(query.q).trim();
      if (q) filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } }
      ];
    }

    const threads = await Thread.find(filter).sort({ createdAt: -1 }).lean();
    const authorIds = Array.from(new Set(threads.map((thread) => String(thread.authorId)).filter(Boolean)));
    const authors = await User.find({ _id: { $in: authorIds } }).lean();
    const authorMap = new Map(authors.map((author) => [String(author._id), publicUser(author)]));

    const result = threads.map((thread) => ({
      ...formatThread(thread),
      author: authorMap.get(String(thread.authorId)) || { id: String(thread.authorId), name: "Unknown", email: "" }
    }));

    res.json({ threads: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得討論串列表失敗" });
  }
});

router.post("/create", threadImagesUpload, async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const title = String(req.body?.title || "").trim().slice(0, 80);
    const content = String(req.body?.content || "").trim().slice(0, 3000);
    const subject = String(req.body?.subject || "").trim();
    const tags = parseTags(req.body?.tags);
    const imageUrls = Array.isArray(req.files) ? req.files.slice(0, 4).map((file) => `/uploads/chat/${file.filename}`) : [];

    if (!title || !content) {
      return res.status(400).json({ error: "標題和內容為必填" });
    }

    const thread = await Thread.create({
      authorId: req.userId,
      title,
      content,
      subject,
      tags,
      imageUrls,
      status: "open"
    });

    res.json({ success: true, thread: formatThread(thread) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "建立討論串失敗" });
  }
});

router.get("/:threadId", async (req, res) => {
  try {
    const thread = await Thread.findById(req.params.threadId).lean();
    if (!thread) return res.status(404).json({ error: "找不到討論串" });
    const author = await User.findById(thread.authorId).lean();
    const replies = await ThreadReply.find({ threadId: thread._id }).sort({ createdAt: 1 }).lean();
    const replyAuthorIds = Array.from(new Set(replies.map((reply) => String(reply.authorId)).filter(Boolean)));
    const replyAuthors = await User.find({ _id: { $in: replyAuthorIds } }).lean();
    const replyAuthorMap = new Map(replyAuthors.map((author) => [String(author._id), publicUser(author)]));

    res.json({
      thread: {
        ...formatThread(thread),
        author: publicUser(author) || { id: String(thread.authorId), name: "Unknown", email: "" },
        replies: replies.map((reply) => ({
          ...formatReply(reply),
          author: replyAuthorMap.get(String(reply.authorId)) || { id: String(reply.authorId), name: "Unknown", email: "" }
        }))
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "取得討論串失敗" });
  }
});

router.post("/:threadId/reply", threadImagesUpload, async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const thread = await Thread.findById(req.params.threadId);
    if (!thread) return res.status(404).json({ error: "找不到討論串" });

    const content = String(req.body?.content || "").trim().slice(0, 3000);
    if (!content) return res.status(400).json({ error: "回覆內容不可為空" });

    const imageUrls = Array.isArray(req.files) ? req.files.slice(0, 4).map((file) => `/uploads/chat/${file.filename}`) : [];
    const reply = await ThreadReply.create({
      threadId: thread._id,
      authorId: req.userId,
      content,
      imageUrls
    });

    res.json({ success: true, reply: formatReply(reply) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "回覆討論串失敗" });
  }
});

router.post("/:threadId/accept-reply", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const thread = await Thread.findById(req.params.threadId);
    if (!thread) return res.status(404).json({ error: "找不到討論串" });
    if (String(thread.authorId) !== req.userId) return res.status(403).json({ error: "只有討論串作者可以執行此操作" });

    const replyId = String(req.body?.replyId || "").trim();
    const reply = await ThreadReply.findOne({ _id: replyId, threadId: thread._id });
    if (!reply) return res.status(404).json({ error: "找不到回覆" });

    thread.acceptedReplyId = reply._id;
    thread.status = "solved";
    await thread.save();
    res.json({ success: true, thread: formatThread(thread) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "標記最佳解答失敗" });
  }
});

router.post("/:threadId/close", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const thread = await Thread.findById(req.params.threadId);
    if (!thread) return res.status(404).json({ error: "找不到討論串" });
    if (String(thread.authorId) !== req.userId) return res.status(403).json({ error: "只有討論串作者可以關閉或重新開啟" });

    const requestedStatus = String(req.body?.status || "").trim();
    if (requestedStatus === "open" || requestedStatus === "solved") {
      thread.status = requestedStatus;
    } else {
      thread.status = thread.status === "solved" ? "open" : "solved";
    }
    await thread.save();
    res.json({ success: true, thread: formatThread(thread) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "更新討論串狀態失敗" });
  }
});

module.exports = router;
