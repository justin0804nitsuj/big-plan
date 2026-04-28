const jwt = require("jsonwebtoken");
const { User } = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET;

async function authMiddleware(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader;

  if (!token) {
    return res.status(401).json({ error: "請先登入" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ error: "找不到使用者" });
    }

    req.userId = user._id.toString();
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "登入狀態已失效，請重新登入" });
  }
}

module.exports = authMiddleware;
