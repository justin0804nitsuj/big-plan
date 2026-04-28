const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { User } = require("../models/User");
const Group = require("../models/Group");
const Message = require("../models/Message");

const JWT_SECRET = process.env.JWT_SECRET;

function getDmRoomId(userIdA, userIdB) {
  return ["dm", String(userIdA), String(userIdB)].sort().join("_");
}

function getGroupRoomId(groupId) {
  return `group_${groupId}`;
}

function formatMessage(message) {
  const msg = typeof message.toObject === "function" ? message.toObject() : message;
  return {
    ...msg,
    id: String(msg._id || msg.id),
    senderId: msg.senderId ? String(msg.senderId) : null,
    receiverId: msg.receiverId ? String(msg.receiverId) : null,
    groupId: msg.groupId ? String(msg.groupId) : null,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt
  };
}

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

async function areFriends(userId, friendId) {
  const user = await User.findById(userId).lean();
  return user?.friends?.some((id) => String(id) === String(friendId));
}

function getIo(io) {
  return io;
}

function getUserPublic(user) {
  return user ? { id: String(user._id), name: user.name, email: user.email } : { id: null, name: "Unknown", email: "" };
}

async function initializeChatSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("請先登入"));
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).lean();
      if (!user) return next(new Error("找不到使用者"));
      socket.userId = String(user._id);
      next();
    } catch (err) {
      next(new Error("登入狀態已失效，請重新登入"));
    }
  });

  io.on("connection", (socket) => {
    addOnlineSocket(socket.userId, socket.id);
    socket.join(`user_${socket.userId}`);

    Array.from(onlineUsers.keys()).forEach((userId) => {
      socket.emit("presence:update", { userId, online: true });
    });
    io.to(`user_${socket.userId}`).emit("presence:update", { userId: socket.userId, online: true });

    socket.on("join:dm", async ({ friendId } = {}) => {
      if (!friendId) return socket.emit("chat:error", { error: "請提供好友 ID" });
      const isFriend = await areFriends(socket.userId, friendId);
      if (!isFriend) {
        socket.emit("chat:error", { error: "只能與好友聊天" });
        return;
      }
      const roomId = getDmRoomId(socket.userId, friendId);
      socket.join(roomId);
      const messages = await Message.find({ roomId }).sort({ createdAt: -1 }).limit(50).lean();
      socket.emit("messages:history", messages.reverse().map(formatMessage));
    });

    socket.on("message:send", async ({ friendId, content, type = "text" } = {}) => {
      if (!friendId) return socket.emit("chat:error", { error: "請提供好友 ID" });
      const isFriend = await areFriends(socket.userId, friendId);
      if (!isFriend) {
        socket.emit("chat:error", { error: "只能傳訊息給好友" });
        return;
      }
      const text = String(content || "").trim().slice(0, 1000);
      if (!text) return;
      const message = await Message.create({
        roomId: getDmRoomId(socket.userId, friendId),
        senderId: socket.userId,
        receiverId: friendId,
        type: type === "quick" ? "quick" : "text",
        content: text,
        imageUrl: "",
        deletedFor: []
      });
      const formatted = formatMessage(message);
      io.to(formatted.roomId).emit("message:new", formatted);
    });

    socket.on("typing:start", async ({ friendId } = {}) => {
      if (!friendId) return;
      const isFriend = await areFriends(socket.userId, friendId);
      if (!isFriend) return;
      const roomId = getDmRoomId(socket.userId, friendId);
      socket.to(roomId).emit("typing:update", { userId: socket.userId, typing: true });
    });

    socket.on("join:group", async ({ groupId } = {}) => {
      if (!groupId) return socket.emit("chat:error", { error: "請提供群組 ID" });
      const group = await Group.findById(groupId).lean();
      if (!group) {
        socket.emit("chat:error", { error: "找不到群組" });
        return;
      }
      if (!group.memberIds?.some((id) => String(id) === socket.userId)) {
        socket.emit("chat:error", { error: "你不是這個群組的成員" });
        return;
      }
      const roomId = getGroupRoomId(groupId);
      socket.join(roomId);
      const messages = await Message.find({ roomId }).sort({ createdAt: -1 }).limit(100).lean();
      socket.emit("messages:history", messages.reverse().map(formatMessage));
    });

    socket.on("group:message:send", async ({ groupId, content, type = "text" } = {}) => {
      if (!groupId) return socket.emit("chat:error", { error: "請提供群組 ID" });
      const group = await Group.findById(groupId).lean();
      if (!group) {
        socket.emit("chat:error", { error: "找不到群組" });
        return;
      }
      if (!group.memberIds?.some((id) => String(id) === socket.userId)) {
        socket.emit("chat:error", { error: "你不是這個群組的成員" });
        return;
      }
      const text = String(content || "").trim().slice(0, 1000);
      if (!text) return;
      const message = await Message.create({
        roomId: getGroupRoomId(groupId),
        senderId: socket.userId,
        receiverId: null,
        groupId: group._id,
        type: type === "quick" ? "quick" : "text",
        content: text,
        imageUrl: "",
        deletedFor: []
      });
      const formatted = formatMessage(message);
      io.to(formatted.roomId).emit("group:message:new", formatted);
    });

    socket.on("disconnect", () => {
      const stillOnline = removeOnlineSocket(socket.userId, socket.id);
      if (!stillOnline) io.emit("presence:update", { userId: socket.userId, online: false });
    });
  });
}

module.exports = initializeChatSocket;
