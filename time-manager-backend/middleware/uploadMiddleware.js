const multer = require("multer");
const fs = require("fs");
const path = require("path");

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
const CHAT_UPLOADS_DIR = path.join(UPLOAD_DIR, "chat");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

ensureDir(CHAT_UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, CHAT_UPLOADS_DIR),
  filename: (_req, file, callback) => {
    const extension = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif"
    }[file.mimetype] || path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 10000)}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

module.exports = {
  singleImageUpload: upload.single("image"),
  threadImagesUpload: upload.array("images", 4),
  CHAT_UPLOADS_DIR
};
