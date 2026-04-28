const express = require("express");
const UserData = require("../models/UserData");
const router = express.Router();

function normalizeUserData(value = {}) {
  return {
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    pomodoroHistory: Array.isArray(value.pomodoroHistory) ? value.pomodoroHistory : [],
    focusSessions: Array.isArray(value.focusSessions) ? value.focusSessions : [],
    distractions: Array.isArray(value.distractions) ? value.distractions : [],
    settings: typeof value.settings === "object" && value.settings ? value.settings : {},
    dailyStats: typeof value.dailyStats === "object" && value.dailyStats ? value.dailyStats : {},
    learningProgress: typeof value.learningProgress === "object" && value.learningProgress ? value.learningProgress : {},
    aiLogs: Array.isArray(value.aiLogs) ? value.aiLogs : []
  };
}

router.get("/full", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    let data = await UserData.findOne({ userId: req.userId }).lean();
    if (!data) {
      data = await UserData.create({ userId: req.userId });
      data = data.toObject();
    }
    res.json(normalizeUserData(data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "讀取資料失敗" });
  }
});

router.post("/full", async (req, res) => {
  try {
    if (!req.userId) return res.status(401).json({ error: "請先登入" });
    const payload = normalizeUserData(req.body || {});
    await UserData.findOneAndUpdate(
      { userId: req.userId },
      { $set: payload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "儲存資料失敗" });
  }
});

module.exports = router;
