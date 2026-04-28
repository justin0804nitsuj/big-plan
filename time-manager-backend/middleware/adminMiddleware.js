const ADMIN_EMAILS = String(process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);

function isAdminUser(user) {
  if (!user) return false;
  if (String(user.role) === "admin") return true;
  return Boolean(user.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()));
}

function adminMiddleware(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "請先登入" });
  }
  if (!isAdminUser(req.user)) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  next();
}

module.exports = adminMiddleware;
module.exports.isAdminUser = isAdminUser;
