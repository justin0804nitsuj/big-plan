const LS_GUEST_KEY = "timeManager_guest_v2";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v2";
const LS_AUTH_KEY = "timeManager_auth_v2";
const LS_FOCUS_TASK_KEY = "timeManager_current_focus_task_v2";

const LANGUAGE_ZH = "zh-Hant";
const LANGUAGE_EN = "en";
const PAGE_ORDER = ["dashboard", "focus", "tasks", "learning", "friends", "groups", "threads", "ai", "admin", "settings"];
const QUICK_MESSAGES = [
  "我要開始專注 25 分鐘",
  "一起讀書嗎？",
  "我現在先處理任務",
  "休息一下",
  "等我 5 分鐘"
];
const DASHBOARD_CHART_IDS = [
  "focusMinutesChart",
  "completedTasksChart",
  "categoryTimeChart",
  "estimateActualChart",
  "distractionChart",
  "qualityChart",
  "learningProgressChart"
];
const PAGE_CHART_IDS = {
  dashboard: DASHBOARD_CHART_IDS,
  learning: ["learningSubjectChart"]
};

const DEFAULT_API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:3000"
  : "https://big-plan.onrender.com";
const API_BASE = localStorage.getItem("timeManager_api_base") || DEFAULT_API_BASE;

const PAGE_DEFAULTS = {
  dashboard: {
    zh: {
      title: "今日總覽",
      eyebrow: "總覽",
      subtitle: "用數據、任務與專注儀表板，把今天的注意力放到最值得處理的地方。"
    },
    en: {
      title: "Dashboard",
      eyebrow: "Dashboard",
      subtitle: "Use tasks, focus data, and review notes to put your attention where it matters most today."
    }
  },
  focus: {
    zh: {
      title: "深度專注模式",
      eyebrow: "專注",
      subtitle: "只保留焦點任務、計時器、專注控制與分心紀錄，讓畫面幫你降噪。"
    },
    en: {
      title: "Deep Focus Mode",
      eyebrow: "Focus",
      subtitle: "Keep only the focus task, timer, controls, and distraction log so the screen can quiet the noise."
    }
  },
  tasks: {
    zh: {
      title: "任務系統",
      eyebrow: "任務",
      subtitle: "用優先級、能量、任務類型與智慧分數決定下一步，而不是只靠感覺。"
    },
    en: {
      title: "Task System",
      eyebrow: "Tasks",
      subtitle: "Use priority, energy, task type, and smart scores to choose the next step without relying only on instinct."
    }
  },
  learning: {
    zh: {
      title: "學習計畫",
      eyebrow: "學習",
      subtitle: "把科目進度、複習間隔與學習熱度集中管理，讓記憶曲線變得可操作。"
    },
    en: {
      title: "Learning Plan",
      eyebrow: "Learning",
      subtitle: "Manage subject progress, review intervals, and study heat in one place so memory work becomes actionable."
    }
  },
  friends: {
    zh: {
      title: "Friends+ 協作",
      eyebrow: "好友",
      subtitle: "用私訊、任務共享與同步專注，把個人節奏延伸成可靠的協作。"
    },
    en: {
      title: "Friends+ Collaboration",
      eyebrow: "Friends",
      subtitle: "Use messaging, shared tasks, and synchronized focus sessions to turn personal rhythm into collaboration."
    }
  },
  groups: {
    zh: {
      title: "群組聊天室",
      eyebrow: "群組",
      subtitle: "建立和管理群組，進行群組聊天和協作。"
    },
    en: {
      title: "Group Chat Rooms",
      eyebrow: "Groups",
      subtitle: "Create and manage groups for chat and collaboration."
    }
  },
  threads: {
    zh: {
      title: "公開討論串",
      eyebrow: "討論區",
      subtitle: "發問、附圖片、回覆與標記最佳解答，讓學習問題可以被整理與解決。"
    },
    en: {
      title: "Public Threads",
      eyebrow: "Threads",
      subtitle: "Ask questions, attach images, reply, and mark accepted answers."
    }
  },
  ai: {
    zh: {
      title: "AI 助理",
      eyebrow: "AI",
      subtitle: "先以模擬回應建立前端資料流程，未來可把 AI 請求改接後端或 OpenAI 介面。"
    },
    en: {
      title: "AI Assistant",
      eyebrow: "AI",
      subtitle: "The app starts with mock responses; later the AI request can be wired to a backend or OpenAI API."
    }
  },
  admin: {
    zh: {
      title: "管理員面板",
      eyebrow: "管理員",
      subtitle: "管理員專用功能，只有授權使用者可見。"
    },
    en: {
      title: "Admin Panel",
      eyebrow: "Admin",
      subtitle: "Admin-only tools and management functions for authorized users."
    }
  },
  settings: {
    zh: {
      title: "設定與資料",
      eyebrow: "設定",
      subtitle: "管理帳號、專注時長、語言、快捷鍵與 JSON 匯入匯出；訪客與登入同步都保留。"
    },
    en: {
      title: "Settings and Data",
      eyebrow: "Settings",
      subtitle: "Manage account, focus length, language, shortcuts, and JSON import/export for guest or synced data."
    }
  }
};

const AI_ENDPOINTS = {
  "plan-day": "/ai/plan-day",
  "suggest-task": "/ai/suggest-task",
  "breakdown-task": "/ai/breakdown-task",
  analyze: "/ai/analyze"
};

let authState = { mode: "guest", user: null, token: null };
let appData = getEmptyData();
let currentPage = "dashboard";
let currentTaskIdForPomodoro = null;
let isLoginMode = true;
let sortable = null;
let saveDataDebounceTimer = null;
let chartInstances = {};
let lastAIResult = null;
let syncStatusState = "localReady";
let friendsState = {
  friends: [],
  requests: { incoming: [], outgoing: [] },
  selectedFriendId: null,
  messages: [],
  sharedTasks: [],
  focusRoom: null,
  focusPollTimer: null,
  focusPollFriendId: null
};
let chatSocket = null;
let activeChatFriendId = null;
let activeMessages = [];
let activeGroupId = null;
let activeGroupMessages = [];
let isShowingGroups = false; // 新增：追蹤當前顯示的是好友還是群組列表
let currentUserIsAdmin = false;
let typingTimer = null;
let onlineUserIds = new Set();
let onlineFriends = [];
let isOnlineOverlayVisible = false;
let friendsRealtimeTimer = null;
let activeFocusFriendId = null;
let threadsState = {
  threads: [],
  currentThreadId: null,
  currentThread: null,
  filters: {
    search: "",
    subject: "",
    status: "",
    tag: ""
  }
};

const timerState = {
  remainingSeconds: 25 * 60,
  plannedSeconds: 25 * 60,
  running: false,
  timerId: null,
  activeSession: null,
  pendingSession: null
};

function getEmptyData() {
  return {
    tasks: [],
    pomodoroHistory: [],
    focusSessions: [],
    distractions: [],
    settings: {
      focusMinutes: 25,
      breakMinutes: 5,
      language: LANGUAGE_ZH
    },
    dailyStats: {},
    learningProgress: {
      subjects: []
    },
    aiLogs: []
  };
}

function $(id) {
  return document.getElementById(id);
}

function getAppLanguage() {
  return appData?.settings?.language === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH;
}

function isEnglish() {
  return getAppLanguage() === LANGUAGE_EN;
}

function ui(zh, en) {
  return isEnglish() ? en : zh;
}

function getPageCopy(page) {
  const copy = PAGE_DEFAULTS[page] || PAGE_DEFAULTS.dashboard;
  return isEnglish() ? copy.en : copy.zh;
}

function pageLabel(page) {
  return {
    dashboard: ui("總覽", "Dashboard"),
    focus: ui("專注", "Focus"),
    tasks: ui("任務", "Tasks"),
    learning: ui("學習", "Learning"),
    friends: ui("好友", "Friends"),
    groups: ui("群組", "Groups"),
    threads: ui("討論區", "Threads"),
    ai: ui("AI 助理", "AI Assistant"),
    admin: ui("管理員", "Admin"),
    settings: ui("設定", "Settings")
  }[page] || page;
}

function syncStatusText(status) {
  return {
    localReady: ui("本機就緒", "Local ready"),
    guestLocal: ui("訪客本機資料", "Guest local"),
    syncing: ui("同步中...", "Syncing..."),
    synced: ui("已同步", "Synced"),
    syncFailed: ui("同步失敗", "Sync failed"),
    offlineCache: ui("離線快取", "Offline cache")
  }[status] || status;
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function todayKey() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateString, days) {
  const date = dateString ? new Date(`${dateString}T00:00:00`) : new Date();
  if (Number.isNaN(date.getTime())) return todayKey();
  date.setDate(date.getDate() + Number(days || 0));
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

function getWeekDates() {
  return Array.from({ length: 7 }, (_, index) => addDays(todayKey(), index - 6));
}

function clampNumber(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveAssetUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return String(url);
  return API_BASE.replace(/\/$/, "") + "/" + String(url).replace(/^\//, "");
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((tag) => tag.trim()).filter(Boolean);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTask(task = {}) {
  const status = ["todo", "doing", "done", "deferred"].includes(task.status) ? task.status : "todo";
  const priority = ["low", "medium", "high"].includes(task.priority) ? task.priority : "medium";
  const energyRequired = ["low", "medium", "high"].includes(task.energyRequired) ? task.energyRequired : "medium";
  const taskType = ["deep", "shallow"].includes(task.taskType) ? task.taskType : "deep";
  const normalized = {
    id: task.id || createId("t"),
    title: String(task.title || "未命名任務").trim() || "未命名任務",
    description: task.description || "",
    dueDate: task.dueDate || "",
    priority,
    category: task.category || "",
    status,
    tags: normalizeTags(task.tags),
    estimateMinutes: Number(task.estimateMinutes ?? task.estimate ?? 25) || 0,
    actualMinutes: Number(task.actualMinutes) || 0,
    energyRequired,
    taskType,
    score: Number(task.score) || 0,
    subtasks: Array.isArray(task.subtasks)
      ? task.subtasks.map((st) => ({
          id: st.id || createId("st"),
          title: String(st.title || "").trim(),
          status: st.status === "done" ? "done" : "todo"
        })).filter((st) => st.title)
      : [],
    createdAt: task.createdAt || new Date().toISOString(),
    completedAt: task.completedAt || ""
  };
  normalized.score = calculateTaskScore(normalized);
  return normalized;
}

function normalizeFocusSession(session = {}) {
  return {
    id: session.id || createId("fs"),
    taskId: session.taskId || null,
    taskTitle: session.taskTitle || "",
    startedAt: session.startedAt || session.createdAt || new Date().toISOString(),
    endedAt: session.endedAt || session.finishedAt || new Date().toISOString(),
    durationMinutes: Number(session.durationMinutes ?? session.duration ?? session.minutes) || 0,
    plannedMinutes: Number(session.plannedMinutes) || Number(appData?.settings?.focusMinutes) || 25,
    focusScore: Number(session.focusScore) || 0,
    summary: session.summary || "",
    distractionsCount: Number(session.distractionsCount) || 0,
    distractions: Array.isArray(session.distractions) ? session.distractions.map((item) => normalizeDistraction(item)) : [],
    createdAt: session.createdAt || new Date().toISOString()
  };
}

function normalizeDistraction(distraction = {}) {
  return {
    id: distraction.id || createId("d"),
    sessionId: distraction.sessionId || null,
    taskId: distraction.taskId || null,
    content: distraction.content || distraction.text || "",
    createdAt: distraction.createdAt || distraction.time || new Date().toISOString()
  };
}

function normalizePomodoroHistory(item = {}) {
  return {
    id: item.id || createId("p"),
    taskId: item.taskId || null,
    taskTitle: item.taskTitle || "",
    mode: item.mode === "break" ? "break" : "focus",
    duration: Number(item.duration ?? item.durationMinutes) || 0,
    finishedAt: item.finishedAt || item.endedAt || new Date().toISOString(),
    focusSessionId: item.focusSessionId || null
  };
}

function normalizeSubject(subject = {}) {
  const targetMinutes = Number(subject.targetMinutes) || 300;
  const studiedMinutes = Number(subject.studiedMinutes) || 0;
  return {
    id: subject.id || createId("s"),
    name: String(subject.name || "未命名科目").trim() || "未命名科目",
    targetMinutes,
    studiedMinutes,
    currentUnit: subject.currentUnit || "",
    nextReviewDate: subject.nextReviewDate || "",
    note: subject.note || "",
    interval: Math.max(1, Number(subject.interval) || 1),
    easeFactor: Math.max(1.3, Number(subject.easeFactor) || 2.5),
    reviewHistory: Array.isArray(subject.reviewHistory)
      ? subject.reviewHistory.map((review) => ({
          reviewedAt: review.reviewedAt || review.date || new Date().toISOString(),
          interval: Number(review.interval) || 1,
          easeFactor: Number(review.easeFactor) || 2.5
        }))
      : [],
    createdAt: subject.createdAt || new Date().toISOString()
  };
}

function normalizeAILog(log = {}) {
  return {
    id: log.id || createId("ai"),
    action: log.action || "unknown",
    requestedAt: log.requestedAt || log.createdAt || new Date().toISOString(),
    result: log.result && typeof log.result === "object" ? log.result : { title: ui("AI 回應", "AI Response"), summary: String(log.result || "") }
  };
}

function normalizeAppData(data) {
  const empty = getEmptyData();
  const value = data && typeof data === "object" ? data : {};
  const learningProgress = value.learningProgress && typeof value.learningProgress === "object"
    ? value.learningProgress
    : { subjects: Array.isArray(value.subjects) ? value.subjects : [] };

  return {
    tasks: Array.isArray(value.tasks) ? value.tasks.map(normalizeTask) : [],
    pomodoroHistory: Array.isArray(value.pomodoroHistory) ? value.pomodoroHistory.map(normalizePomodoroHistory) : [],
    focusSessions: Array.isArray(value.focusSessions) ? value.focusSessions.map(normalizeFocusSession) : [],
    distractions: Array.isArray(value.distractions) ? value.distractions.map(normalizeDistraction) : [],
    settings: {
      focusMinutes: Math.max(1, Number(value.settings?.focusMinutes) || empty.settings.focusMinutes),
      breakMinutes: Math.max(1, Number(value.settings?.breakMinutes) || empty.settings.breakMinutes),
      language: value.settings?.language === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH
    },
    dailyStats: value.dailyStats && typeof value.dailyStats === "object" ? value.dailyStats : {},
    learningProgress: {
      subjects: Array.isArray(learningProgress.subjects) ? learningProgress.subjects.map(normalizeSubject) : []
    },
    aiLogs: Array.isArray(value.aiLogs) ? value.aiLogs.map(normalizeAILog).slice(0, 50) : []
  };
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

  const subtaskCount = Array.isArray(task.subtasks) ? task.subtasks.length : 0;
  const doneSubtasks = Array.isArray(task.subtasks) ? task.subtasks.filter((st) => st.status === "done").length : 0;
  if (subtaskCount > 0) score += Math.round((doneSubtasks / subtaskCount) * 8);

  return Math.max(0, Math.round(score));
}

function priorityRank(task) {
  return { high: 3, medium: 2, low: 1 }[task.priority] || 1;
}

function isTodayTask(task) {
  return task.dueDate === todayKey() || (!task.dueDate && task.status !== "done");
}

function isOverdue(task) {
  return task.status !== "done" && task.dueDate && task.dueDate < todayKey();
}

function priorityText(priority) {
  return isEnglish()
    ? ({ low: "Low", medium: "Medium", high: "High" }[priority] || "Medium")
    : ({ low: "低", medium: "中", high: "高" }[priority] || "中");
}

function statusText(status) {
  return isEnglish()
    ? ({ todo: "To do", doing: "Doing", done: "Done", deferred: "Deferred" }[status] || "To do")
    : ({ todo: "待辦", doing: "進行中", done: "已完成", deferred: "延後" }[status] || "待辦");
}

function categoryText(category) {
  const labels = isEnglish()
    ? {
        school: "School",
        research: "Research",
        work: "Work",
        project: "Project",
        personal: "Personal",
        study: "Study"
      }
    : {
        school: "學校",
        research: "研究",
        work: "工作",
        project: "專案",
        personal: "個人",
        study: "學習"
      };
  return labels[category] || ui("未分類", "Uncategorized");
}

function energyText(energy) {
  return isEnglish()
    ? ({ low: "Low energy", medium: "Medium energy", high: "High energy" }[energy] || "Medium energy")
    : ({ low: "低能量", medium: "中能量", high: "高能量" }[energy] || "中能量");
}

function taskTypeText(type) {
  if (isEnglish()) return type === "shallow" ? "Shallow" : "Deep";
  return type === "shallow" ? "淺層" : "深度";
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function setSyncStatus(message) {
  const label = $("syncStatusLabel");
  syncStatusState = message;
  if (label) label.textContent = syncStatusText(message);
}

function setText(selector, text) {
  const element = document.querySelector(selector);
  if (element) element.textContent = text;
}

function setPlaceholder(id, text) {
  const element = $(id);
  if (element) element.placeholder = text;
}

function setLabelNodeText(label, text) {
  if (!label) return;
  const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (textNode) {
    textNode.textContent = `${text} `;
  } else {
    label.insertBefore(document.createTextNode(`${text} `), label.firstChild);
  }
}

function setControlLabel(controlId, text) {
  setLabelNodeText($(controlId)?.closest("label"), text);
}

function setOptionLabels(selectId, labels) {
  const select = $(selectId);
  if (!select) return;
  Object.entries(labels).forEach(([value, label]) => {
    const option = Array.from(select.options).find((item) => item.value === value);
    if (option) option.textContent = label;
  });
}

function applySelectTranslations() {
  setOptionLabels("taskFilter", {
    all: ui("全部", "All"),
    today: ui("今日", "Today"),
    todo: statusText("todo"),
    doing: statusText("doing"),
    done: statusText("done"),
    deferred: statusText("deferred"),
    overdue: ui("已逾期", "Overdue"),
    deep: ui("深度工作", "Deep Work"),
    shallow: ui("淺層工作", "Shallow Work")
  });
  setOptionLabels("taskStatus", {
    todo: statusText("todo"),
    doing: statusText("doing"),
    done: statusText("done"),
    deferred: statusText("deferred")
  });
  setOptionLabels("taskPriority", {
    low: priorityText("low"),
    medium: priorityText("medium"),
    high: priorityText("high")
  });
  setOptionLabels("taskCategory", {
    "": categoryText(""),
    school: categoryText("school"),
    research: categoryText("research"),
    work: categoryText("work"),
    project: categoryText("project"),
    personal: categoryText("personal"),
    study: categoryText("study")
  });
  setOptionLabels("taskEnergy", {
    low: priorityText("low"),
    medium: priorityText("medium"),
    high: priorityText("high")
  });
  setOptionLabels("taskType", {
    deep: taskTypeText("deep"),
    shallow: taskTypeText("shallow")
  });
  setOptionLabels("languageSelect", {
    [LANGUAGE_ZH]: ui("繁體中文", "Traditional Chinese"),
    [LANGUAGE_EN]: ui("英文", "English")
  });
  const languageSelect = $("languageSelect");
  if (languageSelect) languageSelect.value = getAppLanguage();
}

function applyLanguage() {
  document.documentElement.lang = getAppLanguage();
  document.title = ui("Focus OS V2 | 個人學習管理器", "Focus OS V2 | Personal Learning Manager");
  document.querySelector(".sidebar")?.setAttribute("aria-label", ui("主要導覽", "Main navigation"));

  setText(".brand-block .eyebrow", ui("個人學習管理器", "Personal Learning Manager"));
  PAGE_ORDER.forEach((page) => setText(`.nav-link[data-page="${page}"]`, pageLabel(page)));
  setText("#headerSettingsBtn", pageLabel("settings"));
  setSyncStatus(syncStatusState);
  updatePageHeader();

  setText(".metric-grid .metric-card:nth-child(1) span", ui("今日任務", "Today's tasks"));
  setText(".metric-grid .metric-card:nth-child(2) span", ui("今日專注", "Focus today"));
  setText(".metric-grid .metric-card:nth-child(3) span", ui("本週完成", "Done this week"));
  setText(".metric-grid .metric-card:nth-child(4) span", ui("平均品質", "Average quality"));
  setText(".metric-grid .metric-card:nth-child(5) span", ui("今日分心", "Distractions today"));

  setText("#page-dashboard .focus-summary-panel .eyebrow", ui("下一個焦點", "Next Focus"));
  setText("#page-dashboard .focus-summary-panel h3", ui("目前焦點任務", "Current Focus Task"));
  setText("#selectTopTaskBtn", ui("智慧挑選", "Smart pick"));
  setText("#page-dashboard .reflection-panel .eyebrow", ui("回顧", "Review"));
  setText("#page-dashboard .reflection-panel h3", ui("今日回顧", "Daily Review"));
  setText("#saveReflectionBtn", ui("儲存", "Save"));
  setPlaceholder("dailyReflectionInput", ui("今天完成了什麼？哪裡卡住？明天要讓哪件事更順？", "What did you finish today? What got stuck? What should go smoother tomorrow?"));

  setText(".charts-grid .chart-card:nth-child(1) h3", ui("最近 7 天專注分鐘", "Focus Minutes, Last 7 Days"));
  setText(".charts-grid .chart-card:nth-child(2) h3", ui("最近 7 天完成任務", "Completed Tasks, Last 7 Days"));
  setText(".charts-grid .chart-card:nth-child(3) h3", ui("任務分類時間", "Time by Task Category"));
  setText(".charts-grid .chart-card:nth-child(4) h3", ui("預估時間與實際時間", "Estimated vs Actual Time"));
  setText(".charts-grid .chart-card:nth-child(5) h3", ui("每日分心次數", "Daily Distractions"));
  setText(".charts-grid .chart-card:nth-child(6) h3", ui("專注品質平均分數", "Average Focus Quality"));
  setText(".charts-grid .chart-card:nth-child(7) h3", ui("學習科目進度", "Learning Subject Progress"));
  setText(".charts-grid .chart-card:nth-child(8) h3", ui("學習熱度圖", "Learning Heatmap"));
  $("learningHeatmapDashboard")?.setAttribute("aria-label", ui("最近學習熱度", "Recent learning heat"));
  $("learningHeatmapLearning")?.setAttribute("aria-label", ui("學習熱度圖", "Learning heatmap"));

  setText("#page-focus .deep-focus-panel > .section-head .eyebrow", ui("深度專注模式", "Deep Focus Mode"));
  setText("#page-focus .deep-focus-panel > .section-head h3", ui("目前焦點任務", "Current Focus Task"));
  setText("#startTimerBtn", ui("開始", "Start"));
  setText("#pauseTimerBtn", ui("暫停", "Pause"));
  setText("#resetTimerBtn", ui("重設", "Reset"));
  setText("#endFocusBtn", ui("結束專注", "End focus"));
  setControlLabel("distractionInput", ui("分心紀錄", "Distraction log"));
  setPlaceholder("distractionInput", ui("專注中想到雜念時輸入，按 Enter 儲存", "Type a distraction during focus, then press Enter to save"));
  setText("#focusFeedbackPanel .eyebrow", ui("專注回饋", "Session Feedback"));
  setText("#focusFeedbackPanel h3", ui("這次專注的回饋", "Focus Session Feedback"));
  setControlLabel("focusScoreInput", ui("專注分數：1 到 5", "Focus score: 1 to 5"));
  setControlLabel("focusSummaryInput", ui("摘要：這次完成了什麼", "Summary: what did this session complete"));
  setPlaceholder("focusSummaryInput", ui("簡短記錄成果，讓未來的效率分析更有上下文。", "Briefly record the result so future productivity analysis has context."));
  setText("#saveFocusFeedbackBtn", ui("儲存專注紀錄", "Save focus record"));

  setText("#page-tasks .split-layout > .panel:nth-child(1) .eyebrow", ui("任務板", "Task Board"));
  setText("#page-tasks .split-layout > .panel:nth-child(1) h3", ui("任務清單", "Task List"));
  setText("#smartSortBtn", ui("智慧排序", "Smart sort"));
  setText("#page-tasks .split-layout > .panel:nth-child(2) .eyebrow", ui("規劃", "Plan"));
  setText("#page-tasks .split-layout > .panel:nth-child(2) h3", ui("新增 / 編輯任務", "Add / Edit Task"));
  setText("#clearFormBtn", ui("清空", "Clear"));
  setControlLabel("taskTitle", ui("標題", "Title"));
  setControlLabel("taskDescription", ui("描述", "Description"));
  setControlLabel("taskDueDate", ui("期限", "Due date"));
  setControlLabel("taskStatus", ui("狀態", "Status"));
  setControlLabel("taskPriority", ui("優先級", "Priority"));
  setControlLabel("taskCategory", ui("分類", "Category"));
  setControlLabel("taskEnergy", ui("能量需求", "Energy required"));
  setControlLabel("taskType", ui("任務類型", "Task type"));
  setControlLabel("taskTags", ui("標籤", "Tags"));
  setControlLabel("taskEstimate", ui("預估分鐘", "Estimated minutes"));
  setPlaceholder("taskTags", ui("用逗號分隔，例如：報告, 考試, 專案", "Separate with commas, for example: report, exam, project"));
  setText("#taskForm button[type='submit']", ui("儲存任務", "Save task"));

  setText("#page-learning .learning-layout > .panel:nth-child(1) .eyebrow", ui("進度", "Progress"));
  setText("#page-learning .learning-layout > .panel:nth-child(1) h3", ui("學習總進度", "Learning Progress"));
  setText("#page-learning .learning-layout > .panel:nth-child(2) .eyebrow", ui("科目", "Subject"));
  setText("#page-learning .learning-layout > .panel:nth-child(2) h3", ui("新增學習科目", "Add Learning Subject"));
  setControlLabel("subjectNameInput", ui("科目 / 主題", "Subject / Topic"));
  setControlLabel("subjectTargetInput", ui("目標分鐘", "Target minutes"));
  setControlLabel("subjectUnitInput", ui("目前單元", "Current unit"));
  setControlLabel("subjectReviewInput", ui("下次複習", "Next review"));
  setControlLabel("subjectIntervalInput", ui("間隔天數", "Interval days"));
  setControlLabel("subjectEaseInput", ui("記憶係數", "Ease factor"));
  setControlLabel("subjectNoteInput", ui("備註", "Notes"));
  setPlaceholder("subjectUnitInput", ui("例如：事件監聽、第三章", "Example: DOM events, Chapter 3"));
  setText("#learningForm button[type='submit']", ui("新增學習計畫", "Add learning plan"));
  setText("#page-learning > .panel .eyebrow", ui("複習佇列", "Review Queue"));
  setText("#page-learning > .panel h3", ui("科目清單", "Subject List"));

  setText("#page-friends .friend-list-panel .eyebrow", ui("好友列表", "Friend List"));
  setText("#page-friends .friend-list-panel h3", ui("我的好友", "My Friends"));
  setText("#page-friends .friend-request-panel .eyebrow", ui("好友邀請", "Friend Requests"));
  setText("#page-friends .friend-request-panel h3", ui("新增與回覆邀請", "Invite and Respond"));
  setControlLabel("friendInviteEmail", ui("好友 Email 或 userId", "Friend email or userId"));
  setPlaceholder("friendInviteEmail", ui("friend@example.com", "friend@example.com"));
  setText("#friendInviteForm button[type='submit']", ui("送出邀請", "Send invite"));
  setText("#page-friends .chat-panel .eyebrow", ui("私訊聊天區", "Direct Messages"));
  setPlaceholder("chatInput", ui("輸入訊息...", "Type a message..."));
  setText("#openImagePickerBtn", ui("圖片", "Image"));
  setText("#chatForm button[type='submit']", ui("送出", "Send"));
  setText("#typingIndicator", ui("對方正在輸入...", "Friend is typing..."));
  updateChatPresenceLabel();
  document.querySelectorAll(".quick-message").forEach((button, index) => {
    const zh = QUICK_MESSAGES[index] || button.dataset.message || button.textContent;
    const en = [
      "I am starting a 25-minute focus",
      "Study together?",
      "I am handling a task first",
      "Taking a break",
      "Wait 5 minutes for me"
    ][index] || zh;
    const text = ui(zh, en);
    button.textContent = text;
    button.dataset.message = text;
  });
  setText("#page-friends .task-share-panel .eyebrow", ui("任務共享區", "Shared Tasks"));
  $("shareTaskSelect")?.setAttribute("aria-label", ui("選擇要分享的任務", "Choose a task to share"));
  setText("#shareTaskBtn", ui("分享任務", "Share task"));
  setText("#page-friends .focus-room-panel .eyebrow", ui("一起專注區", "Focus Together"));
  setControlLabel("focusRoomMinutesInput", ui("專注分鐘", "Focus minutes"));
  setText("#createFocusRoomBtn", ui("邀請一起專注", "Invite to focus"));
  setText("#page-friends .friend-meta-panel .eyebrow", ui("好友暱稱 / 備註設定", "Nickname / Notes"));
  setControlLabel("friendNicknameInput", ui("自訂暱稱", "Custom nickname"));
  setControlLabel("friendNoteInput", ui("備註", "Notes"));
  setText("#friendMetaForm button[type='submit']", ui("儲存好友設定", "Save friend settings"));
  if (currentPage === "friends") renderFriendsContent();

  setText("#page-ai .ai-layout > .panel:nth-child(1) .eyebrow", ui("動作", "Actions"));
  setText("#page-ai .ai-layout > .panel:nth-child(1) h3", ui("AI 輔助入口", "AI Actions"));
  setText(".ai-action[data-ai-action='plan-day']", ui("幫我安排今天", "Plan my day"));
  setText(".ai-action[data-ai-action='suggest-task']", ui("幫我挑下一個任務", "Suggest my next task"));
  setText(".ai-action[data-ai-action='breakdown-task']", ui("幫我拆解目前任務", "Break down current task"));
  setText(".ai-action[data-ai-action='analyze']", ui("分析我的效率", "Analyze my productivity"));
  setText("#page-ai .ai-result-panel .eyebrow", ui("結果", "Result"));
  setText("#page-ai .ai-result-panel h3", ui("AI 回應", "AI Response"));
  setText("#page-ai .ai-log-panel .eyebrow", ui("紀錄", "Logs"));
  setText("#page-ai .ai-log-panel h3", ui("AI 紀錄", "AI Logs"));
  if (lastAIResult) renderAIResult(lastAIResult);
  else {
    setText("#aiResultSource", ui("模擬就緒", "Mock ready"));
    const aiResult = $("aiResult");
    if (aiResult?.classList.contains("empty-state")) {
      aiResult.textContent = ui("選擇一個 AI 動作後，結果會顯示在這裡。", "Choose an AI action and the result will appear here.");
    }
  }

  setText("#page-settings .account-settings-panel .eyebrow", ui("帳號", "Account"));
  setText("#page-settings .account-settings-panel h3", ui("帳號資訊", "Account Info"));
  setText("#settingsEmailLabel", ui("電子郵件", "Email"));
  setText("#settingsNameLabel", ui("名稱", "Name"));
  setText("#changeNameBtn", ui("變更名稱", "Change name"));
  setControlLabel("newPasswordInput", ui("新密碼", "New password"));
  setPlaceholder("newPasswordInput", ui("至少 8 個字元", "At least 8 characters"));
  setText("#changePasswordBtn", ui("變更密碼", "Change password"));
  setText("#deleteAccountBtn", ui("刪除帳號", "Delete account"));
  setText("#page-settings .timer-settings-panel .eyebrow", ui("計時器", "Timer"));
  setText("#page-settings .timer-settings-panel h3", ui("專注設定", "Focus Settings"));
  setControlLabel("focusMinutesInput", ui("專注分鐘", "Focus minutes"));
  setControlLabel("breakMinutesInput", ui("休息分鐘", "Break minutes"));
  setText("#saveSettingsBtn", ui("儲存設定", "Save settings"));
  setText("#page-settings .backup-settings-panel .eyebrow", ui("備份", "Backup"));
  setText("#page-settings .backup-settings-panel h3", ui("JSON 匯入 / 匯出", "JSON Import / Export"));
  setText("#exportJsonBtn", ui("匯出 JSON", "Export JSON"));
  setLabelNodeText(document.querySelector(".file-button"), ui("匯入 JSON", "Import JSON"));
  setText("#apiBasePrefix", ui("目前 API：", "Current API: "));
  setText("#page-settings .preference-settings-panel .eyebrow", ui("偏好", "Preferences"));
  setText("#page-settings .preference-settings-panel h3", ui("語言與快捷鍵", "Language and Shortcuts"));
  setControlLabel("languageSelect", ui("語言", "Language"));
  document.querySelector(".shortcut-list")?.setAttribute("aria-label", ui("快捷鍵列表", "Shortcut list"));
  setText("#shortcutNextLabel", ui("切換到下一個左側分頁", "Switch to the next left tab"));
  setText("#shortcutPrevLabel", ui("切換到上一個左側分頁", "Switch to the previous left tab"));
  setText("#shortcutSettingsLabel", ui("直接切換到設定", "Jump directly to Settings"));

  setText("#page-threads .thread-form-panel .eyebrow", ui("發問", "Ask"));
  setText("#page-threads .thread-form-panel h3", ui("提出新問題", "Ask a New Question"));
  setControlLabel("threadTitle", ui("標題", "Title"));
  setControlLabel("threadContent", ui("內容", "Content"));
  setControlLabel("threadSubject", ui("科目", "Subject"));
  setControlLabel("threadTags", ui("標籤", "Tags"));
  setControlLabel("threadImages", ui("圖片", "Images"));
  setText("#threadForm button[type='submit']", ui("發問", "Ask"));
  setPlaceholder("threadSearch", ui("搜尋標題或內容...", "Search title or content..."));
  setText("#page-threads .thread-list-panel .eyebrow", ui("討論串", "Threads"));
  setText("#page-threads .thread-list-panel h3", ui("所有討論", "All Discussions"));
  setText("#threadSubjectFilter option[value='']", ui("所有科目", "All Subjects"));
  setText("#threadStatusFilter option[value='']", ui("所有狀態", "All Statuses"));
  setText("#threadTagFilter option[value='']", ui("所有標籤", "All Tags"));
  setText("#page-threads .thread-detail-panel .eyebrow", ui("詳細內容", "Details"));
  setText("#closeThreadBtn", ui("結案", "Close"));
  setText("#threadReplies h4", ui("回覆", "Replies"));
  setControlLabel("replyContent", ui("回覆內容", "Reply Content"));
  setControlLabel("replyImages", ui("圖片", "Images"));
  setText("#replyForm button[type='submit']", ui("回覆", "Reply"));

  setControlLabel("authNameInput", ui("名稱", "Name"));
  setControlLabel("authEmailInput", ui("電子郵件", "Email"));
  setControlLabel("authPasswordInput", ui("密碼", "Password"));
  $("authCancelBtn")?.setAttribute("aria-label", ui("關閉", "Close"));

  applySelectTranslations();
  updateAuthUI();
  updateTimerDisplay();
}

function handleLanguageChange(event) {
  appData.settings.language = event.target.value === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH;
  saveData();
  applyLanguage();
  renderAll();
  showToast(ui("已切換為中文介面", "Switched to English interface"));
}

function focusActiveNavButton() {
  document.querySelector(`.nav-link[data-page="${currentPage}"]`)?.focus({ preventScroll: true });
}

function switchPageByOffset(offset) {
  const currentIndex = PAGE_ORDER.indexOf(currentPage);
  const nextIndex = (currentIndex + offset + PAGE_ORDER.length) % PAGE_ORDER.length;
  setPage(PAGE_ORDER[nextIndex]);
  focusActiveNavButton();
}

function handleKeyboardShortcuts(event) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;

  if (event.key === "Escape") {
    event.preventDefault();
    $("authModal")?.classList.add("hidden");
    setPage("settings");
    focusActiveNavButton();
  }
}

async function apiRequest(path, options = {}) {
  const { headers = {}, ...restOptions } = options;
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    ...restOptions,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...headers
    }
  });

  if (!res.ok) {
    let errorMessage = `HTTP ${res.status}`;
    try {
      const errorJson = await res.json();
      errorMessage = errorJson?.error || errorMessage;
    } catch (_) {}
    throw new Error(errorMessage);
  }

  return res.status === 204 ? null : res.json();
}

async function authenticatedApiRequest(path, options = {}) {
  if (authState.mode !== "user" || !authState.token) {
    throw new Error(ui("請先登入。", "Please sign in first."));
  }
  return apiRequest(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${authState.token}`,
      ...(options.headers || {})
    }
  });
}

function loadAuthState() {
  try {
    const raw = localStorage.getItem(LS_AUTH_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed?.mode === "user" && parsed?.token) authState = parsed;
  } catch (_) {}
}

function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

function saveData() {
  appData = normalizeAppData(appData);
  if (currentTaskIdForPomodoro) localStorage.setItem(LS_FOCUS_TASK_KEY, currentTaskIdForPomodoro);

  if (authState.mode === "user") {
    localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
    scheduleSaveDataToServer();
  } else {
    localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
    setSyncStatus("guestLocal");
  }
}

function scheduleSaveDataToServer() {
  if (!authState.token) return;
  setSyncStatus("syncing");
  if (saveDataDebounceTimer) clearTimeout(saveDataDebounceTimer);
  saveDataDebounceTimer = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify(appData)
      });
      setSyncStatus("synced");
    } catch (err) {
      setSyncStatus("syncFailed");
      showToast(ui(`同步失敗：${err.message}`, `Sync failed: ${err.message}`));
    }
  }, 700);
}

async function loadUserDataFromServer() {
  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: { Authorization: `Bearer ${authState.token}` }
  });
  appData = normalizeAppData(data);
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
  setSyncStatus("synced");
}

function mergeArrayById(base, incoming) {
  const map = new Map();
  base.forEach((item) => map.set(item.id, item));
  incoming.forEach((item) => {
    if (!map.has(item.id)) map.set(item.id, item);
  });
  return Array.from(map.values());
}

function mergeDailyStats(base, incoming) {
  const merged = { ...incoming, ...base };
  Object.keys(incoming || {}).forEach((date) => {
    if (base?.[date] && incoming?.[date]) merged[date] = { ...incoming[date], ...base[date] };
  });
  return merged;
}

function mergeAppData(baseData, incomingData) {
  const base = normalizeAppData(baseData);
  const incoming = normalizeAppData(incomingData);
  return normalizeAppData({
    ...base,
    tasks: mergeArrayById(base.tasks, incoming.tasks),
    pomodoroHistory: mergeArrayById(base.pomodoroHistory, incoming.pomodoroHistory),
    focusSessions: mergeArrayById(base.focusSessions, incoming.focusSessions),
    distractions: mergeArrayById(base.distractions, incoming.distractions),
    dailyStats: mergeDailyStats(base.dailyStats, incoming.dailyStats),
    learningProgress: {
      subjects: mergeArrayById(base.learningProgress.subjects, incoming.learningProgress.subjects)
    },
    aiLogs: mergeArrayById(base.aiLogs, incoming.aiLogs).slice(0, 50)
  });
}

function setPage(page) {
  if (page === "admin" && currentUserIsAdmin !== true) {
    showToast(ui("沒有管理員權限", "No admin permission"));
    return;
  }
  const previousPage = currentPage;
  currentPage = PAGE_DEFAULTS[page] ? page : "dashboard";
  if (previousPage === "friends" && currentPage !== "friends") {
    stopFocusRoomPolling();
    stopFriendsRealtimePolling();
  }
  if (currentPage === "friends") {
    startFriendsRealtimePolling();
  }
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `page-${currentPage}`);
  });
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === currentPage);
  });

  updatePageHeader();
  cleanupChartsForPage();
  renderAll();
}

function updatePageHeader() {
  const copy = getPageCopy(currentPage);
  $("pageTitle").textContent = copy.title;
  $("pageEyebrow").textContent = copy.eyebrow;
  $("pageSubtitle").textContent = copy.subtitle;
}

function getCurrentTask() {
  return appData.tasks.find((task) => task.id === currentTaskIdForPomodoro) || null;
}

function getFilteredTasks() {
  const filter = $("taskFilter")?.value || "all";
  return appData.tasks.filter((task) => {
    if (filter === "today") return isTodayTask(task);
    if (filter === "todo") return task.status === "todo";
    if (filter === "doing") return task.status === "doing";
    if (filter === "done") return task.status === "done";
    if (filter === "deferred") return task.status === "deferred";
    if (filter === "overdue") return isOverdue(task);
    if (filter === "deep") return task.taskType === "deep";
    if (filter === "shallow") return task.taskType === "shallow";
    return true;
  });
}

function renderTaskList() {
  const list = $("taskList");
  if (!list) return;
  list.innerHTML = "";

  const tasks = getFilteredTasks();
  if (!tasks.length) {
    list.innerHTML = `<li class="empty-state">${ui("目前沒有符合條件的任務。", "No tasks match the current filter.")}</li>`;
    initSortable();
    return;
  }

  const fragment = document.createDocumentFragment();
  tasks.forEach((task) => {
    task.score = calculateTaskScore(task);
    const li = document.createElement("li");
    li.className = `task-item ${task.status} ${isOverdue(task) ? "overdue" : ""}`;
    li.dataset.taskId = task.id;
    li.dataset.category = task.category || "";

    const subDone = task.subtasks.filter((st) => st.status === "done").length;
    const tagHtml = task.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");

    li.innerHTML = `
      <div class="task-top">
        <label class="check-line">
          <input type="checkbox" ${task.status === "done" ? "checked" : ""} />
          <span class="task-title">${escapeHtml(task.title)}</span>
        </label>
        <span class="status-pill">${ui("分數", "Score")} ${task.score}</span>
      </div>
      <p class="task-description">${escapeHtml(task.description || ui("沒有描述", "No description"))}</p>
      <div class="task-meta">
        <span>${task.dueDate || ui("無期限", "No due date")}</span>
        <span>${statusText(task.status)}</span>
        <span>${categoryText(task.category)}</span>
        <span>${task.actualMinutes} / ${task.estimateMinutes} ${ui("分", "min")}</span>
        <span>${subDone} / ${task.subtasks.length} ${ui("子任務", "subtasks")}</span>
      </div>
      <div class="tag-row">
        <span class="badge ${task.priority}">${isEnglish() ? `${priorityText(task.priority)} priority` : `${priorityText(task.priority)}優先`}</span>
        <span class="badge ${task.energyRequired}">${energyText(task.energyRequired)}</span>
        <span class="badge ${task.taskType}">${taskTypeText(task.taskType)}</span>
        ${isOverdue(task) ? `<span class="badge high">${ui("已逾期", "Overdue")}</span>` : ""}
        ${tagHtml}
      </div>
      <div class="subtask-container"></div>
      <input class="subtask-input" placeholder="${ui("+ 新增子任務，按 Enter", "+ Add subtask, press Enter")}" />
      <div class="task-actions">
        <button class="small edit-btn secondary" type="button">${ui("編輯", "Edit")}</button>
        <button class="small focus-btn" type="button">${ui("設為焦點", "Set focus")}</button>
        <button class="small done-btn secondary" type="button">${task.status === "done" ? ui("重開", "Reopen") : ui("完成", "Complete")}</button>
        <button class="small danger delete-btn" type="button">${ui("刪除", "Delete")}</button>
      </div>
    `;

    li.querySelector("input[type='checkbox']").onchange = (event) => {
      setTaskStatus(task.id, event.target.checked ? "done" : "todo");
    };
    li.querySelector(".edit-btn").onclick = () => fillTaskForm(task);
    li.querySelector(".focus-btn").onclick = () => setFocusTask(task.id, true);
    li.querySelector(".done-btn").onclick = () => setTaskStatus(task.id, task.status === "done" ? "todo" : "done");
    li.querySelector(".delete-btn").onclick = () => deleteTask(task.id);

    const subtaskContainer = li.querySelector(".subtask-container");
    task.subtasks.forEach((subtask) => {
      const row = document.createElement("label");
      row.className = "subtask-item";
      row.innerHTML = `
        <input type="checkbox" ${subtask.status === "done" ? "checked" : ""} />
        <span class="${subtask.status === "done" ? "st-done" : ""}">${escapeHtml(subtask.title)}</span>
      `;
      row.querySelector("input").onchange = (event) => {
        subtask.status = event.target.checked ? "done" : "todo";
        saveData();
        renderAll();
      };
      subtaskContainer.appendChild(row);
    });

    li.querySelector(".subtask-input").onkeydown = (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      const title = event.target.value.trim();
      if (!title) return;
      task.subtasks.push({ id: createId("st"), title, status: "todo" });
      event.target.value = "";
      saveData();
      renderAll();
    };

    fragment.appendChild(li);
  });

  list.appendChild(fragment);
  initSortable();
}

function initSortable() {
  if (!window.Sortable) return;
  const el = $("taskList");
  if (!el) return;
  if (sortable) sortable.destroy();
  sortable = new Sortable(el, {
    animation: 160,
    filter: ".empty-state",
    onEnd: () => {
      if (($("taskFilter")?.value || "all") !== "all") return;
      const ids = Array.from(el.querySelectorAll(".task-item")).map((item) => item.dataset.taskId);
      const map = new Map(appData.tasks.map((task) => [task.id, task]));
      appData.tasks = ids.map((id) => map.get(id)).filter(Boolean);
      saveData();
    }
  });
}

function setTaskStatus(taskId, status) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.status = status;
  task.completedAt = status === "done" ? task.completedAt || new Date().toISOString() : "";
  task.score = calculateTaskScore(task);
  saveData();
  renderAll();
}

function setFocusTask(taskId, goToFocus = false) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task) return;
  currentTaskIdForPomodoro = task.id;
  localStorage.setItem(LS_FOCUS_TASK_KEY, task.id);
  if (task.status === "todo") task.status = "doing";
  task.score = calculateTaskScore(task);
  saveData();
  if (goToFocus) setPage("focus");
  else renderAll();
  showToast(ui(`已設定焦點任務：${task.title}`, `Focus task set: ${task.title}`));
}

function deleteTask(taskId) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task || !confirm(ui(`確定要刪除「${task.title}」？`, `Delete "${task.title}"?`))) return;
  appData.tasks = appData.tasks.filter((item) => item.id !== taskId);
  if (currentTaskIdForPomodoro === taskId) {
    currentTaskIdForPomodoro = null;
    localStorage.removeItem(LS_FOCUS_TASK_KEY);
  }
  saveData();
  renderAll();
}

function fillTaskForm(task) {
  setPage("tasks");
  $("taskId").value = task.id;
  $("taskTitle").value = task.title;
  $("taskDescription").value = task.description;
  $("taskDueDate").value = task.dueDate;
  $("taskStatus").value = task.status;
  $("taskPriority").value = task.priority;
  $("taskCategory").value = task.category;
  $("taskEnergy").value = task.energyRequired;
  $("taskType").value = task.taskType;
  $("taskTags").value = task.tags.join(", ");
  $("taskEstimate").value = task.estimateMinutes;
  $("taskTitle").focus();
}

function clearTaskForm() {
  $("taskId").value = "";
  $("taskTitle").value = "";
  $("taskDescription").value = "";
  $("taskDueDate").value = "";
  $("taskStatus").value = "todo";
  $("taskPriority").value = "medium";
  $("taskCategory").value = "";
  $("taskEnergy").value = "medium";
  $("taskType").value = "deep";
  $("taskTags").value = "";
  $("taskEstimate").value = "25";
}

function handleTaskSubmit(event) {
  event.preventDefault();
  const id = $("taskId").value.trim();
  const title = $("taskTitle").value.trim();
  if (!title) return;

  const payload = {
    title,
    description: $("taskDescription").value.trim(),
    dueDate: $("taskDueDate").value,
    status: $("taskStatus").value,
    priority: $("taskPriority").value,
    category: $("taskCategory").value,
    energyRequired: $("taskEnergy").value,
    taskType: $("taskType").value,
    tags: normalizeTags($("taskTags").value),
    estimateMinutes: Number($("taskEstimate").value) || 0
  };

  if (id) {
    const task = appData.tasks.find((item) => item.id === id);
    if (task) {
      Object.assign(task, payload, {
        completedAt: payload.status === "done" ? task.completedAt || new Date().toISOString() : ""
      });
      task.score = calculateTaskScore(task);
    }
    showToast(ui("任務已更新", "Task updated"));
  } else {
    appData.tasks.push(normalizeTask({ ...payload, id: createId("t"), createdAt: new Date().toISOString() }));
    showToast(ui("任務已新增", "Task added"));
  }

  saveData();
  clearTaskForm();
  renderAll();
}

function pickTopTask(goToFocus = true) {
  const candidates = appData.tasks
    .filter((task) => task.status !== "done" && task.status !== "deferred")
    .map((task) => ({ ...task, score: calculateTaskScore(task) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (priorityRank(a) !== priorityRank(b)) return priorityRank(b) - priorityRank(a);
      return String(a.dueDate || "9999-12-31").localeCompare(String(b.dueDate || "9999-12-31"));
    });

  if (!candidates.length) {
    showToast(ui("目前沒有可安排的任務", "There are no tasks to schedule right now"));
    return null;
  }

  setFocusTask(candidates[0].id, goToFocus);
  return candidates[0];
}

function smartSortTasks() {
  appData.tasks.forEach((task) => {
    task.score = calculateTaskScore(task);
  });
  appData.tasks.sort((a, b) => b.score - a.score);
  saveData();
  renderAll();
  showToast(ui("已依任務分數由高到低排序", "Tasks sorted by score from high to low"));
}

function buildFocusTaskHtml(task) {
  if (!task) return `<p>${ui("尚未指定焦點任務。", "No focus task selected yet.")}</p>`;
  return `
    <div class="tag-row">
      <span class="status-pill">${statusText(task.status)}</span>
      <span class="badge ${task.priority}">${isEnglish() ? `${priorityText(task.priority)} priority` : `${priorityText(task.priority)}優先`}</span>
      <span class="badge ${task.taskType}">${taskTypeText(task.taskType)}</span>
      ${isOverdue(task) ? `<span class="status-pill danger-soft">${ui("已逾期", "Overdue")}</span>` : ""}
    </div>
    <h4>${escapeHtml(task.title)}</h4>
    <p>${escapeHtml(task.description || ui("沒有描述", "No description"))}</p>
    <div class="task-meta">
      <span>${task.dueDate || ui("無期限", "No due date")}</span>
      <span>${categoryText(task.category)}</span>
      <span>${task.actualMinutes} / ${task.estimateMinutes} ${ui("分", "min")}</span>
      <span>${ui("分數", "Score")} ${calculateTaskScore(task)}</span>
    </div>
  `;
}

function renderFocusCards() {
  const task = getCurrentTask();
  const dashboardCard = $("focusTaskCard");
  const focusCard = $("focusPageTaskCard");
  [dashboardCard, focusCard].forEach((card) => {
    if (!card) return;
    card.className = `focus-card ${task ? "" : "empty"}`;
    card.innerHTML = buildFocusTaskHtml(task);
  });
}

function updateCurrentTaskLabel() {
  const task = getCurrentTask();
  const label = $("currentTaskLabel");
  if (label) label.textContent = task ? ui(`現在專注：${task.title}`, `Now focusing: ${task.title}`) : ui("尚未選擇焦點任務", "No focus task selected");
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  const timerValue = $("timerValue");
  const modeLabel = $("timerModeLabel");
  if (timerValue) timerValue.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (modeLabel) modeLabel.textContent = timerState.running ? ui("專注中", "Focusing") : ui("專注", "Focus");
}

function applySettingsToTimer() {
  const focusInput = $("focusMinutesInput");
  const breakInput = $("breakMinutesInput");
  if (focusInput) focusInput.value = appData.settings.focusMinutes;
  if (breakInput) breakInput.value = appData.settings.breakMinutes;
  if (!timerState.running && !timerState.pendingSession) {
    timerState.plannedSeconds = appData.settings.focusMinutes * 60;
    timerState.remainingSeconds = timerState.plannedSeconds;
    updateTimerDisplay();
  }
}

function createActiveFocusSession() {
  const task = getCurrentTask();
  if (!task) return null;
  if (!timerState.activeSession) {
    timerState.activeSession = {
      id: createId("fs"),
      taskId: task.id,
      taskTitle: task.title,
      startedAt: new Date().toISOString(),
      plannedMinutes: appData.settings.focusMinutes,
      distractions: []
    };
    timerState.plannedSeconds = appData.settings.focusMinutes * 60;
    if (timerState.remainingSeconds <= 0 || timerState.remainingSeconds > timerState.plannedSeconds) {
      timerState.remainingSeconds = timerState.plannedSeconds;
    }
  }
  return timerState.activeSession;
}

function startTimer() {
  if (timerState.running) return;
  if (!getCurrentTask()) {
    const picked = pickTopTask(false);
    if (!picked) return;
  }

  const feedbackPanel = $("focusFeedbackPanel");
  if (feedbackPanel) feedbackPanel.classList.add("hidden");
  timerState.pendingSession = null;

  if (!createActiveFocusSession()) {
    showToast(ui("請先選擇焦點任務", "Choose a focus task first"));
    return;
  }

  timerState.running = true;
  timerState.timerId = setInterval(() => {
    timerState.remainingSeconds -= 1;
    if (timerState.remainingSeconds <= 0) {
      timerState.remainingSeconds = 0;
      updateTimerDisplay();
      endFocusSession(true);
      return;
    }
    updateTimerDisplay();
  }, 1000);
  updateTimerDisplay();
  renderFocusPage();
}

function pauseTimer() {
  timerState.running = false;
  clearInterval(timerState.timerId);
  timerState.timerId = null;
  updateTimerDisplay();
  renderFocusPage();
}

function resetTimer() {
  pauseTimer();
  timerState.activeSession = null;
  timerState.pendingSession = null;
  timerState.plannedSeconds = appData.settings.focusMinutes * 60;
  timerState.remainingSeconds = timerState.plannedSeconds;
  const feedbackPanel = $("focusFeedbackPanel");
  if (feedbackPanel) feedbackPanel.classList.add("hidden");
  updateTimerDisplay();
  renderFocusPage();
}

function endFocusSession(autoCompleted = false) {
  pauseTimer();
  const task = getCurrentTask();
  if (!task) {
    showToast(ui("沒有焦點任務可結束", "There is no focus task to end"));
    return;
  }

  const active = timerState.activeSession || {
    id: createId("fs"),
    taskId: task.id,
    taskTitle: task.title,
    startedAt: new Date().toISOString(),
    plannedMinutes: appData.settings.focusMinutes,
    distractions: []
  };

  const timerElapsed = Math.round((timerState.plannedSeconds - timerState.remainingSeconds) / 60);
  const clockElapsed = Math.round((Date.now() - new Date(active.startedAt).getTime()) / 60000);
  const durationMinutes = Math.max(1, timerElapsed || clockElapsed || 1);
  const sessionDistractions = appData.distractions.filter((item) => item.sessionId === active.id);

  timerState.pendingSession = {
    ...active,
    endedAt: new Date().toISOString(),
    durationMinutes,
    autoCompleted,
    distractions: sessionDistractions,
    distractionsCount: sessionDistractions.length
  };
  timerState.activeSession = null;

  const panel = $("focusFeedbackPanel");
  const meta = $("focusFeedbackMeta");
  const score = $("focusScoreInput");
  const summary = $("focusSummaryInput");
  if (panel) panel.classList.remove("hidden");
  if (meta) meta.textContent = ui(
    `${durationMinutes} 分鐘 · 分心 ${sessionDistractions.length} 次`,
    `${durationMinutes} min · ${sessionDistractions.length} distractions`
  );
  if (score) score.value = autoCompleted ? "5" : "4";
  if (summary) summary.value = "";
  renderFocusPage();
}

function saveFocusFeedback(event) {
  event.preventDefault();
  const pending = timerState.pendingSession;
  if (!pending) return;

  const task = appData.tasks.find((item) => item.id === pending.taskId);
  const focusScore = clampNumber($("focusScoreInput").value, 1, 5);
  const summary = $("focusSummaryInput").value.trim();
  const session = normalizeFocusSession({
    ...pending,
    taskTitle: task?.title || pending.taskTitle || "",
    focusScore,
    summary
  });

  appData.focusSessions.push(session);
  appData.pomodoroHistory.push(normalizePomodoroHistory({
    id: createId("p"),
    taskId: session.taskId,
    taskTitle: session.taskTitle,
    mode: "focus",
    duration: session.durationMinutes,
    finishedAt: session.endedAt,
    focusSessionId: session.id
  }));

  if (task) {
    task.actualMinutes += session.durationMinutes;
    task.score = calculateTaskScore(task);
  }

  updateDailyStatsForFocus(session);
  timerState.pendingSession = null;
  timerState.plannedSeconds = appData.settings.focusMinutes * 60;
  timerState.remainingSeconds = timerState.plannedSeconds;
  $("focusFeedbackPanel").classList.add("hidden");
  saveData();
  renderAll();
  showToast(ui("專注紀錄已儲存", "Focus record saved"));
}

function updateDailyStatsForFocus(session) {
  const key = (session.endedAt || new Date().toISOString()).slice(0, 10);
  const stats = appData.dailyStats[key] || {};
  const scores = Array.isArray(stats.focusScores) ? stats.focusScores : [];
  scores.push(session.focusScore);
  const focusMinutes = Number(stats.focusMinutes) || 0;
  const distractionsCount = Number(stats.distractionsCount) || 0;
  appData.dailyStats[key] = {
    ...stats,
    focusMinutes: focusMinutes + session.durationMinutes,
    distractionsCount: distractionsCount + session.distractionsCount,
    focusScores: scores,
    focusScoreAvg: scores.reduce((sum, score) => sum + Number(score || 0), 0) / scores.length,
    updatedAt: new Date().toISOString()
  };
}

function recordDistraction(event) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  const input = event.target;
  const content = input.value.trim();
  if (!content) return;
  if (!timerState.running || !timerState.activeSession) {
    showToast(ui("請先開始專注，再記錄分心", "Start focusing before logging distractions"));
    return;
  }

  const distraction = normalizeDistraction({
    id: createId("d"),
    sessionId: timerState.activeSession.id,
    taskId: timerState.activeSession.taskId,
    content,
    createdAt: new Date().toISOString()
  });
  appData.distractions.push(distraction);
  timerState.activeSession.distractions.push(distraction);
  input.value = "";
  saveData();
  renderFocusPage();
}

function renderFocusPage() {
  renderFocusCards();
  updateCurrentTaskLabel();
  updateTimerDisplay();
  const countLabel = $("distractionCountLabel");
  if (!countLabel) return;
  const sessionId = timerState.activeSession?.id || timerState.pendingSession?.id;
  const count = sessionId ? appData.distractions.filter((item) => item.sessionId === sessionId).length : 0;
  countLabel.textContent = ui(`本次分心 ${count} 次`, `${count} distractions this session`);
}

function savePomodoroSettings() {
  const focus = Number($("focusMinutesInput").value);
  const breakMinutes = Number($("breakMinutesInput").value);
  if (focus < 1 || breakMinutes < 1) return alert(ui("時間設定必須大於 0", "Time settings must be greater than 0"));
  appData.settings.focusMinutes = Math.round(focus);
  appData.settings.breakMinutes = Math.round(breakMinutes);
  const languageSelect = $("languageSelect");
  if (languageSelect) appData.settings.language = languageSelect.value === LANGUAGE_EN ? LANGUAGE_EN : LANGUAGE_ZH;
  saveData();
  applySettingsToTimer();
  applyLanguage();
  showToast(ui("設定已儲存", "Settings saved"));
}

function getFocusMinutesOnDate(date) {
  const sessionMinutes = appData.focusSessions
    .filter((item) => (item.endedAt || item.startedAt || "").slice(0, 10) === date)
    .reduce((sum, item) => sum + Number(item.durationMinutes || 0), 0);
  const legacyPomodoroMinutes = appData.pomodoroHistory
    .filter((item) => item.mode === "focus" && !item.focusSessionId && item.finishedAt?.slice(0, 10) === date)
    .reduce((sum, item) => sum + Number(item.duration || 0), 0);
  return sessionMinutes + legacyPomodoroMinutes;
}

function getCompletedTasksOnDate(date) {
  return appData.tasks.filter((task) => task.completedAt?.slice(0, 10) === date).length;
}

function getDistractionsOnDate(date) {
  return appData.distractions.filter((item) => item.createdAt?.slice(0, 10) === date).length;
}

function getAverageFocusScoreOnDate(date) {
  const scores = appData.focusSessions
    .filter((item) => (item.endedAt || item.startedAt || "").slice(0, 10) === date)
    .map((item) => Number(item.focusScore || 0))
    .filter((score) => score > 0);
  if (!scores.length) return 0;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 10) / 10;
}

function getTodayStats() {
  const today = todayKey();
  const todayTasks = appData.tasks.filter((task) => task.dueDate === today || (!task.dueDate && task.status !== "done"));
  const todayDone = todayTasks.filter((task) => task.status === "done").length;
  return {
    todayTasks,
    todayDone,
    focusMinutes: getFocusMinutesOnDate(today),
    distractions: getDistractionsOnDate(today),
    quality: getAverageFocusScoreOnDate(today)
  };
}

function renderMetrics() {
  const { todayTasks, todayDone, focusMinutes, distractions, quality } = getTodayStats();
  $("metricTodayTasks").textContent = `${todayDone} / ${todayTasks.length}`;
  $("metricFocusMinutes").textContent = `${focusMinutes} ${ui("分", "min")}`;
  const weekDone = appData.tasks.filter((task) => task.completedAt && getWeekDates().includes(task.completedAt.slice(0, 10))).length;
  $("metricWeekDone").textContent = `${weekDone} ${ui("件", "done")}`;
  $("metricQuality").textContent = quality ? `${quality} / 5` : "-";
  $("metricDistractions").textContent = `${distractions} ${ui("次", "times")}`;
}

function chartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: "#d8dee9" } }
    },
    scales: {
      x: { ticks: { color: "#a9b3c2" }, grid: { color: "rgba(255,255,255,.07)" } },
      y: { beginAtZero: true, ticks: { color: "#a9b3c2", precision: 0 }, grid: { color: "rgba(255,255,255,.07)" } }
    }
  };
}

function pieOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "bottom", labels: { color: "#d8dee9" } }
    }
  };
}

function isElementVisible(el) {
  return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
}

function createChart(canvasId, config) {
  const canvas = $(canvasId);
  if (!canvas || !window.Chart || !isElementVisible(canvas)) return;
  const existing = chartInstances[canvasId] || window.Chart.getChart?.(canvas);

  if (existing && existing.config?.type === config.type) {
    existing.data = config.data;
    existing.options = config.options;
    try {
      existing.update("none");
    } catch (_) {
      existing.update();
    }
    chartInstances[canvasId] = existing;
    return;
  }

  if (existing) existing.destroy();
  chartInstances[canvasId] = new Chart(canvas.getContext("2d"), config);
}

function destroyChart(canvasId) {
  const chart = chartInstances[canvasId] || window.Chart?.getChart?.($(canvasId));
  if (chart) chart.destroy();
  delete chartInstances[canvasId];
}

function cleanupChartsForPage(page = currentPage) {
  const keep = new Set(PAGE_CHART_IDS[page] || []);
  Object.keys(chartInstances).forEach((canvasId) => {
    if (!keep.has(canvasId)) destroyChart(canvasId);
  });
}

function getCategoryTimeData() {
  const totals = new Map();
  const tasksWithSessions = new Set();
  appData.focusSessions.forEach((session) => {
    const task = appData.tasks.find((item) => item.id === session.taskId);
    const label = categoryText(task?.category || "");
    if (!task) return;
    tasksWithSessions.add(task.id);
    totals.set(label, (totals.get(label) || 0) + Number(session.durationMinutes || 0));
  });
  appData.tasks.forEach((task) => {
    if (tasksWithSessions.has(task.id)) return;
    const label = categoryText(task.category);
    totals.set(label, (totals.get(label) || 0) + Number(task.actualMinutes || 0));
  });
  return Array.from(totals.entries()).filter(([, minutes]) => minutes > 0);
}

function getLearningProgressData() {
  return appData.learningProgress.subjects.map((subject) => ({
    label: subject.name,
    value: subject.targetMinutes > 0 ? Math.min(100, Math.round((subject.studiedMinutes / subject.targetMinutes) * 100)) : 0
  }));
}

function renderCharts() {
  const dates = getWeekDates();
  const labels = dates.map((date) => date.slice(5));
  const palette = ["#63e6be", "#74c0fc", "#ffd166", "#ff8787", "#b197fc", "#20c997", "#f783ac"];

  if (currentPage === "dashboard") {
    createChart("focusMinutesChart", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: ui("專注分鐘", "Focus minutes"), data: dates.map(getFocusMinutesOnDate), borderColor: "#63e6be", backgroundColor: "rgba(99,230,190,.18)", tension: .35, fill: true }]
      },
      options: chartBaseOptions()
    });

    createChart("completedTasksChart", {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: ui("完成任務", "Completed tasks"), data: dates.map(getCompletedTasksOnDate), backgroundColor: "#74c0fc" }]
      },
      options: chartBaseOptions()
    });

    const categoryData = getCategoryTimeData();
    createChart("categoryTimeChart", {
      type: "pie",
      data: {
        labels: categoryData.length ? categoryData.map(([label]) => label) : [ui("尚無資料", "No data")],
        datasets: [{ data: categoryData.length ? categoryData.map(([, minutes]) => minutes) : [1], backgroundColor: palette }]
      },
      options: pieOptions()
    });

    const estimateTasks = [...appData.tasks]
      .filter((task) => Number(task.estimateMinutes || 0) || Number(task.actualMinutes || 0))
      .sort((a, b) => (b.actualMinutes + b.estimateMinutes) - (a.actualMinutes + a.estimateMinutes))
      .slice(0, 8);
    createChart("estimateActualChart", {
      type: "bar",
      data: {
        labels: estimateTasks.length ? estimateTasks.map((task) => task.title.slice(0, 12)) : [ui("尚無資料", "No data")],
        datasets: [
          { label: ui("預估", "Estimated"), data: estimateTasks.length ? estimateTasks.map((task) => task.estimateMinutes) : [0], backgroundColor: "#ffd166" },
          { label: ui("實際", "Actual"), data: estimateTasks.length ? estimateTasks.map((task) => task.actualMinutes) : [0], backgroundColor: "#63e6be" }
        ]
      },
      options: chartBaseOptions()
    });

    createChart("distractionChart", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: ui("分心次數", "Distractions"), data: dates.map(getDistractionsOnDate), borderColor: "#ff8787", backgroundColor: "rgba(255,135,135,.16)", tension: .35, fill: true }]
      },
      options: chartBaseOptions()
    });

    createChart("qualityChart", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: ui("平均分數", "Average score"), data: dates.map(getAverageFocusScoreOnDate), borderColor: "#b197fc", backgroundColor: "rgba(177,151,252,.14)", tension: .35, fill: true }]
      },
      options: { ...chartBaseOptions(), scales: { ...chartBaseOptions().scales, y: { ...chartBaseOptions().scales.y, suggestedMax: 5 } } }
    });

    const learningData = getLearningProgressData();
    createChart("learningProgressChart", {
      type: "bar",
      data: {
        labels: learningData.length ? learningData.map((item) => item.label) : [ui("尚無資料", "No data")],
        datasets: [{ label: ui("進度 %", "Progress %"), data: learningData.length ? learningData.map((item) => item.value) : [0], backgroundColor: "#20c997" }]
      },
      options: chartBaseOptions()
    });
  }

  if (currentPage === "learning") {
    const learningData = getLearningProgressData();
    createChart("learningSubjectChart", {
      type: "bar",
      data: {
        labels: learningData.length ? learningData.map((item) => item.label) : [ui("尚無資料", "No data")],
        datasets: [{ label: ui("進度 %", "Progress %"), data: learningData.length ? learningData.map((item) => item.value) : [0], backgroundColor: "#63e6be" }]
      },
      options: chartBaseOptions()
    });
  }
}

function getLearningHeatValue(date) {
  const stats = appData.dailyStats[date] || {};
  const studyMinutes = Number(stats.studyMinutes) || 0;
  const reviews = Number(stats.reviews) || 0;
  return studyMinutes + reviews * 20;
}

function renderHeatmap(containerId) {
  const container = $(containerId);
  if (!container) return;
  const dates = Array.from({ length: 56 }, (_, index) => addDays(todayKey(), index - 55));
  container.innerHTML = dates.map((date) => {
    const value = getLearningHeatValue(date);
    const level = value >= 120 ? 4 : value >= 75 ? 3 : value >= 30 ? 2 : value > 0 ? 1 : 0;
    return `<span class="heat-cell heat-${level}" title="${date} · ${value} ${ui("分", "min")}"></span>`;
  }).join("");
}

function renderLearningHeatmaps() {
  renderHeatmap("learningHeatmapDashboard");
  renderHeatmap("learningHeatmapLearning");
}

function renderLearning() {
  const list = $("learningList");
  const summary = $("learningSummaryLabel");
  const bar = $("learningProgressBar");
  if (!list || !summary || !bar) return;

  const subjects = appData.learningProgress.subjects;
  const totalTarget = subjects.reduce((sum, subject) => sum + Number(subject.targetMinutes || 0), 0);
  const totalStudied = subjects.reduce((sum, subject) => sum + Number(subject.studiedMinutes || 0), 0);
  const percent = totalTarget > 0 ? Math.min(100, Math.round((totalStudied / totalTarget) * 100)) : 0;
  summary.textContent = `${percent}%`;
  bar.style.width = `${percent}%`;

  if (!subjects.length) {
    list.innerHTML = `<li class="empty-state">${ui("新增第一個學習科目後，這裡會顯示進度與複習排程。", "Add your first subject to see progress and review scheduling here.")}</li>`;
    return;
  }

  list.innerHTML = "";
  const fragment = document.createDocumentFragment();
  subjects.forEach((subject) => {
    const item = document.createElement("li");
    const subjectPercent = subject.targetMinutes > 0 ? Math.min(100, Math.round((subject.studiedMinutes / subject.targetMinutes) * 100)) : 0;
    const reviewDue = subject.nextReviewDate && subject.nextReviewDate <= todayKey();
    item.className = `learning-item ${reviewDue ? "review-due" : ""}`;
    item.innerHTML = `
      <div class="learning-head">
        <strong>${escapeHtml(subject.name)}</strong>
        <span>${subject.studiedMinutes} / ${subject.targetMinutes} ${ui("分", "min")}</span>
      </div>
      <div class="progress-track small-track"><div class="progress-bar" style="width:${subjectPercent}%"></div></div>
      <p class="note">${escapeHtml(subject.currentUnit || ui("尚未設定目前單元", "No current unit set"))}</p>
      <div class="learning-meta">
        <span>${reviewDue ? ui("今天需要複習", "Review due today") : ui(`下次複習：${subject.nextReviewDate || "未設定"}`, `Next review: ${subject.nextReviewDate || "Not set"}`)}</span>
        <span>${ui("間隔", "interval")} ${subject.interval}</span>
        <span>${ui("記憶係數", "ease")} ${subject.easeFactor.toFixed(1)}</span>
        <span>${ui(`複習 ${subject.reviewHistory.length} 次`, `${subject.reviewHistory.length} reviews`)}</span>
      </div>
      <p class="note">${escapeHtml(subject.note || "")}</p>
      <div class="learning-actions">
        <button class="small add25" type="button">+25 ${ui("分", "min")}</button>
        <button class="small secondary add5" type="button">+5 ${ui("分", "min")}</button>
        <button class="small secondary review" type="button">${ui("完成複習", "Complete review")}</button>
        <button class="small danger remove" type="button">${ui("刪除", "Delete")}</button>
      </div>
    `;
    item.querySelector(".add25").onclick = () => addStudyMinutes(subject.id, 25);
    item.querySelector(".add5").onclick = () => addStudyMinutes(subject.id, 5);
    item.querySelector(".review").onclick = () => completeReview(subject.id);
    item.querySelector(".remove").onclick = () => removeSubject(subject.id);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}

function addSubject(event) {
  event.preventDefault();
  const name = $("subjectNameInput").value.trim();
  const targetMinutes = Number($("subjectTargetInput").value);
  if (!name || targetMinutes <= 0) return;

  appData.learningProgress.subjects.push(normalizeSubject({
    id: createId("s"),
    name,
    targetMinutes,
    studiedMinutes: 0,
    currentUnit: $("subjectUnitInput").value.trim(),
    nextReviewDate: $("subjectReviewInput").value,
    interval: Number($("subjectIntervalInput").value) || 1,
    easeFactor: Number($("subjectEaseInput").value) || 2.5,
    note: $("subjectNoteInput").value.trim()
  }));

  $("learningForm").reset();
  $("subjectTargetInput").value = "300";
  $("subjectIntervalInput").value = "1";
  $("subjectEaseInput").value = "2.5";
  saveData();
  renderAll();
  showToast(ui("學習科目已新增", "Subject added"));
}

function addStudyMinutes(subjectId, minutes) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject) return;
  subject.studiedMinutes += minutes;
  if (!subject.nextReviewDate) subject.nextReviewDate = addDays(todayKey(), subject.interval || 1);
  const stats = appData.dailyStats[todayKey()] || {};
  appData.dailyStats[todayKey()] = {
    ...stats,
    studyMinutes: Number(stats.studyMinutes || 0) + minutes,
    updatedAt: new Date().toISOString()
  };
  saveData();
  renderAll();
}

function completeReview(subjectId) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject) return;
  const previousInterval = Math.max(1, Number(subject.interval) || 1);
  subject.interval = subject.reviewHistory.length ? Math.max(1, Math.round(previousInterval * subject.easeFactor)) : 1;
  subject.easeFactor = Math.min(3.2, Math.round((Math.max(1.3, subject.easeFactor) + 0.08) * 10) / 10);
  subject.nextReviewDate = addDays(todayKey(), subject.interval);
  subject.reviewHistory.push({
    reviewedAt: new Date().toISOString(),
    interval: subject.interval,
    easeFactor: subject.easeFactor
  });
  const stats = appData.dailyStats[todayKey()] || {};
  appData.dailyStats[todayKey()] = {
    ...stats,
    reviews: Number(stats.reviews || 0) + 1,
    studyMinutes: Number(stats.studyMinutes || 0) + 10,
    updatedAt: new Date().toISOString()
  };
  saveData();
  renderAll();
  showToast(ui(`已排到 ${subject.nextReviewDate} 複習`, `Next review scheduled for ${subject.nextReviewDate}`));
}

function removeSubject(subjectId) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject || !confirm(ui(`確定要刪除「${subject.name}」？`, `Delete "${subject.name}"?`))) return;
  appData.learningProgress.subjects = appData.learningProgress.subjects.filter((item) => item.id !== subjectId);
  saveData();
  renderAll();
}

function saveReflection() {
  const today = todayKey();
  appData.dailyStats[today] = {
    ...(appData.dailyStats[today] || {}),
    reflection: $("dailyReflectionInput").value.trim(),
    updatedAt: new Date().toISOString()
  };
  saveData();
  showToast(ui("今日回顧已儲存", "Daily review saved"));
}

function loadReflection() {
  const input = $("dailyReflectionInput");
  if (input) input.value = appData.dailyStats[todayKey()]?.reflection || "";
}

function exportJson() {
  appData = normalizeAppData(appData);
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `focus-os-v2-${todayKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      appData = normalizeAppData(JSON.parse(String(reader.result || "{}")));
      saveData();
      renderAll();
      showToast(ui("JSON 已匯入並完成資料正規化", "JSON imported and normalized"));
    } catch (_) {
      alert(ui("JSON 格式無法解析，請確認檔案內容。", "Could not parse the JSON file. Please check its contents."));
    }
  };
  reader.readAsText(file);
}

function buildAIPayload() {
  return {
    tasks: appData.tasks,
    focusSessions: appData.focusSessions,
    distractions: appData.distractions,
    dailyStats: appData.dailyStats,
    learningProgress: appData.learningProgress,
    currentTask: getCurrentTask()
  };
}

async function requestAI(action, payload) {
  const endpoint = AI_ENDPOINTS[action];
  if (endpoint) {
    try {
      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...payload, language: getAppLanguage() })
      });
      return { ...result, source: "backend-mock" };
    } catch (err) {
      const local = mockAIResponse(action, payload);
      return { ...local, source: "local-mock", notice: ui(`後端 AI 模擬暫時不可用，已改用前端模擬：${err.message}`, `Backend AI mock is unavailable, so the app used the local mock: ${err.message}`) };
    }
  }
  return { ...mockAIResponse(action, payload), source: "local-mock" };
}

function mockAIResponse(action, payload) {
  const tasks = (payload.tasks || [])
    .filter((task) => task.status !== "done" && task.status !== "deferred")
    .map((task) => ({ ...task, score: calculateTaskScore(task) }))
    .sort((a, b) => b.score - a.score);
  const current = payload.currentTask || tasks[0] || null;

  if (action === "plan-day") {
    const planItems = tasks.slice(0, 4).map((task, index) => {
      const block = index === 0 ? ui("第一個深度專注區塊", "First deep focus block") : ui(`第 ${index + 1} 個處理區塊`, `Block ${index + 1}`);
      return ui(`${block}：${task.title}（${task.estimateMinutes || 25} 分，分數 ${task.score}）`, `${block}: ${task.title} (${task.estimateMinutes || 25} min, score ${task.score})`);
    });
    return {
      title: ui("今天的建議安排", "Suggested Plan for Today"),
      summary: planItems.length
        ? ui("先處理高分任務，再用低能量時段收尾淺層工作。", "Start with high-score tasks, then use lower-energy time for shallow work.")
        : ui("目前沒有待辦任務，可以安排學習或回顧。", "There are no open tasks right now, so you can schedule study or review time."),
      items: planItems.length ? planItems : [
        ui("新增一個今天最重要的任務", "Add today's most important task"),
        ui("完成 25 分鐘學習", "Complete 25 minutes of study"),
        ui("寫下今日回顧", "Write today's review")
      ],
      taskId: tasks[0]?.id || null
    };
  }

  if (action === "suggest-task") {
    return {
      title: ui("下一個任務建議", "Next Task Suggestion"),
      summary: current
        ? ui(`建議先做「${current.title}」，它目前的智慧分數最高。`, `Start with "${current.title}" because it currently has the highest smart score.`)
        : ui("目前沒有可建議的任務。", "There are no tasks to suggest right now."),
      items: current ? [
        ui(`分數：${calculateTaskScore(current)}`, `Score: ${calculateTaskScore(current)}`),
        ui(`類型：${taskTypeText(current.taskType)}，能量：${energyText(current.energyRequired)}`, `Type: ${taskTypeText(current.taskType)}, energy: ${energyText(current.energyRequired)}`),
        ui(`預估：${current.estimateMinutes || 25} 分`, `Estimate: ${current.estimateMinutes || 25} min`)
      ] : [ui("建立一個明確、可完成的下一步", "Create one clear, completable next step")],
      taskId: current?.id || null
    };
  }

  if (action === "breakdown-task") {
    const title = current?.title || ui("目前任務", "Current task");
    return {
      title: ui(`拆解：${title}`, `Breakdown: ${title}`),
      summary: ui("先把任務拆成可以在 10 到 25 分鐘內完成的小步驟。", "Break the task into small steps that can be finished in 10 to 25 minutes."),
      items: [
        ui("定義完成標準", "Define the finish line"),
        ui("列出需要的資料或工具", "List needed materials or tools"),
        ui("完成最小可交付版本", "Complete the smallest deliverable version"),
        ui("檢查與修正", "Review and fix"),
        ui("記錄下一步", "Record the next step")
      ],
      subtasks: [
        ui("定義完成標準", "Define the finish line"),
        ui("收集必要資料", "Collect necessary materials"),
        ui("完成第一版", "Complete the first version"),
        ui("檢查與修正", "Review and fix")
      ],
      taskId: current?.id || null
    };
  }

  const dates = getWeekDates();
  const focusMinutes = dates.reduce((sum, date) => sum + getFocusMinutesOnDate(date), 0);
  const completed = dates.reduce((sum, date) => sum + getCompletedTasksOnDate(date), 0);
  const distractions = dates.reduce((sum, date) => sum + getDistractionsOnDate(date), 0);
  const avgQualityValues = dates.map(getAverageFocusScoreOnDate).filter(Boolean);
  const avgQuality = avgQualityValues.length
    ? Math.round((avgQualityValues.reduce((sum, value) => sum + value, 0) / avgQualityValues.length) * 10) / 10
    : 0;

  return {
    title: ui("效率分析", "Productivity Analysis"),
    summary: ui("這是依據最近 7 天資料產生的模擬分析。", "This is a mock analysis based on the last 7 days of data."),
    items: [
      ui(`專注總分鐘：${focusMinutes}`, `Total focus minutes: ${focusMinutes}`),
      ui(`完成任務：${completed}`, `Completed tasks: ${completed}`),
      ui(`分心紀錄：${distractions}`, `Distraction logs: ${distractions}`),
      ui(`平均專注品質：${avgQuality || "-"}`, `Average focus quality: ${avgQuality || "-"}`)
    ]
  };
}

function renderAIResult(result) {
  const container = $("aiResult");
  const source = $("aiResultSource");
  if (!container || !result) return;
  source.textContent = result.source === "backend-mock" ? ui("後端模擬", "Backend mock") : ui("本機模擬", "Local mock");
  const items = Array.isArray(result.items) ? result.items : [];
  container.classList.remove("empty-state");
  container.innerHTML = `
    <h4>${escapeHtml(result.title || ui("AI 回應", "AI Response"))}</h4>
    <p>${escapeHtml(result.summary || "")}</p>
    ${result.notice ? `<p class="muted">${escapeHtml(result.notice)}</p>` : ""}
    ${items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    <div class="button-row">
      ${result.taskId ? `<button id="aiSetFocusBtn" class="small" type="button">${ui("設為焦點任務", "Set as focus task")}</button>` : ""}
      ${result.subtasks?.length && result.taskId ? `<button id="applyAiBreakdownBtn" class="small secondary" type="button">${ui("加入子任務", "Add subtasks")}</button>` : ""}
    </div>
  `;

  const focusBtn = $("aiSetFocusBtn");
  if (focusBtn && result.taskId) focusBtn.onclick = () => setFocusTask(result.taskId, true);
  const breakdownBtn = $("applyAiBreakdownBtn");
  if (breakdownBtn && result.taskId) breakdownBtn.onclick = () => applyAIBreakdown(result);
}

function applyAIBreakdown(result) {
  const task = appData.tasks.find((item) => item.id === result.taskId);
  if (!task || !Array.isArray(result.subtasks)) return;
  const existing = new Set(task.subtasks.map((item) => item.title));
  result.subtasks.forEach((title) => {
    if (!existing.has(title)) task.subtasks.push({ id: createId("st"), title, status: "todo" });
  });
  saveData();
  renderAll();
  showToast(ui("AI 拆解已加入子任務", "AI breakdown added to subtasks"));
}

async function handleAIAction(action) {
  const buttons = Array.from(document.querySelectorAll(".ai-action"));
  buttons.forEach((button) => { button.disabled = true; });
  $("aiResult").textContent = ui("AI 模擬正在整理資料...", "AI mock is organizing the data...");
  try {
    const result = await requestAI(action, buildAIPayload());
    lastAIResult = { ...result, action };
    renderAIResult(lastAIResult);
    appData.aiLogs.unshift(normalizeAILog({
      id: createId("ai"),
      action,
      requestedAt: new Date().toISOString(),
      result: lastAIResult
    }));
    appData.aiLogs = appData.aiLogs.slice(0, 50);
    saveData();
    renderAILogs();
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function actionText(action) {
  const labels = isEnglish()
    ? {
        "plan-day": "Plan today",
        "suggest-task": "Suggest next task",
        "breakdown-task": "Break down task",
        analyze: "Productivity analysis"
      }
    : {
        "plan-day": "安排今天",
        "suggest-task": "挑下一個任務",
        "breakdown-task": "拆解任務",
        analyze: "效率分析"
      };
  return labels[action] || action;
}

function renderAILogs() {
  const list = $("aiLogsList");
  if (!list) return;
  if (!appData.aiLogs.length) {
    list.innerHTML = `<li class="empty-state">${ui("尚無 AI 紀錄。", "No AI logs yet.")}</li>`;
    return;
  }
  list.innerHTML = appData.aiLogs.slice(0, 10).map((log) => `
    <li>
      <strong>${escapeHtml(actionText(log.action))}</strong>
      <span> · ${escapeHtml((log.requestedAt || "").slice(0, 16).replace("T", " "))}</span>
      <p class="note">${escapeHtml(log.result?.summary || log.result?.title || "")}</p>
    </li>
  `).join("");
}

async function renderAdmin() {
  const list = $("adminUsersList");
  if (!list) return;

  try {
    const response = await authenticatedApiRequest("/admin/users");
    const users = response.users || [];
    list.innerHTML = users.map((user) => `
      <li class="admin-user-item">
        <div>
          <strong>${escapeHtml(user.name || "無名稱")}</strong> (${escapeHtml(user.email)})
          <span class="status-pill">${user.isAdmin ? ui("管理員", "Admin") : ui("使用者", "User")}</span>
        </div>
        <div class="admin-actions">
          <button class="small secondary view-user-btn" data-user-id="${user.id}" type="button">${ui("查看", "View")}</button>
          <button class="small danger reset-data-btn" data-user-id="${user.id}" type="button">${ui("重設資料", "Reset Data")}</button>
          <button class="small danger delete-user-btn" data-user-id="${user.id}" type="button">${ui("刪除", "Delete")}</button>
        </div>
      </li>
    `).join("");

    list.querySelectorAll(".view-user-btn").forEach(btn => {
      btn.onclick = () => viewUser(btn.dataset.userId);
    });
    list.querySelectorAll(".reset-data-btn").forEach(btn => {
      btn.onclick = () => resetUserData(btn.dataset.userId);
    });
    list.querySelectorAll(".delete-user-btn").forEach(btn => {
      btn.onclick = () => deleteUser(btn.dataset.userId);
    });
  } catch (err) {
    list.innerHTML = `<li class="error-state">${ui("載入使用者列表失敗：", "Failed to load users:")} ${err.message}</li>`;
  }
}

async function viewUser(userId) {
  try {
    const response = await authenticatedApiRequest(`/admin/users/${encodeURIComponent(userId)}`);
    alert(JSON.stringify(response.user, null, 2));
  } catch (err) {
    alert(ui(`查看使用者失敗：${err.message}`, `View user failed: ${err.message}`));
  }
}

async function resetUserData(userId) {
  if (!confirm(ui("確定要重設這個使用者的資料？", "Reset this user's data?"))) return;
  try {
    await authenticatedApiRequest(`/admin/users/${encodeURIComponent(userId)}/reset-data`, { method: "POST" });
    showToast(ui("使用者資料已重設", "User data reset"));
    renderAdmin();
  } catch (err) {
    alert(ui(`重設資料失敗：${err.message}`, `Reset data failed: ${err.message}`));
  }
}

async function deleteUser(userId) {
  if (!confirm(ui("確定要刪除這個使用者？", "Delete this user?"))) return;
  try {
    await authenticatedApiRequest(`/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
    showToast(ui("使用者已刪除", "User deleted"));
    renderAdmin();
  } catch (err) {
    alert(ui(`刪除使用者失敗：${err.message}`, `Delete user failed: ${err.message}`));
  }
}

function selectedFriend() {
  return friendsState.friends.find((friend) => friend.id === friendsState.selectedFriendId) || null;
}

function friendDisplayName(friend) {
  if (!friend) return ui("未選擇好友", "No friend selected");
  return friend.nickname || friend.originalName || friend.name || friend.email || friend.id;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16).replace("T", " ");
  return date.toLocaleString(isEnglish() ? "en-US" : "zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTimer(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function stopFocusRoomPolling() {
  if (friendsState.focusPollTimer) clearInterval(friendsState.focusPollTimer);
  friendsState.focusPollTimer = null;
  friendsState.focusPollFriendId = null;
}

function resetFriendsState() {
  stopFocusRoomPolling();
  disconnectChatSocket();
  activeChatFriendId = null;
  activeMessages = [];
  activeGroupId = null;
  activeGroupMessages = [];
  onlineUserIds = new Set();
  friendsState = {
    friends: [],
    requests: { incoming: [], outgoing: [] },
    selectedFriendId: null,
    messages: [],
    sharedTasks: [],
    focusRoom: null,
    focusPollTimer: null,
    focusPollFriendId: null
  };
  groupsState = {
    groups: [],
    selectedGroupId: null,
    groupMessages: [],
    groupMembers: []
  };
}

function initChatSocket() {
  connectChatSocket();
}

function connectChatSocket() {
  if (authState.mode !== "user" || !authState.token) return null;
  if (!window.io) {
    console.warn("Socket.IO client is not loaded.");
    return null;
  }
  if (chatSocket?.connected) return chatSocket;
  if (chatSocket) {
    chatSocket.auth = { token: authState.token };
    chatSocket.connect();
    return chatSocket;
  }

  chatSocket = window.io(API_BASE, {
    auth: { token: authState.token },
    transports: ["websocket", "polling"]
  });

  chatSocket.on("connect", () => {
    if (activeChatFriendId) chatSocket.emit("join:dm", { friendId: activeChatFriendId });
    if (activeGroupId) chatSocket.emit("join:group", { groupId: activeGroupId });
  });
  chatSocket.on("messages:history", (messages) => {
    activeMessages = Array.isArray(messages) ? messages : [];
    friendsState.messages = activeMessages;
    renderMessages();
  });
  chatSocket.on("message:new", (message) => {
    if (isActiveDmMessage(message)) {
      addOrUpdateMessage(message);
      renderMessages();
    } else if (isActiveGroupMessage(message)) {
      addOrUpdateGroupMessage(message);
      renderGroupMessages();
      // 同時更新 groups 頁面的訊息
      if (groupsState.selectedGroupId === activeGroupId) {
        addOrUpdateGroupsMessage(message);
        renderGroupChat();
      }
    }
  });
  chatSocket.on("group:message:new", (message) => {
    if (isActiveGroupMessage(message)) {
      addOrUpdateGroupMessage(message);
      renderGroupMessages();
      // 同時更新 groups 頁面的訊息
      if (groupsState.selectedGroupId === activeGroupId) {
        addOrUpdateGroupsMessage(message);
        renderGroupChat();
      }
    }
  });
  chatSocket.on("group:message:recalled", ({ messageId }) => {
    if (activeGroupId) {
      recallGroupMessage(messageId);
      renderGroupMessages();
      if (groupsState.selectedGroupId === activeGroupId) {
        recallGroupsMessage(messageId);
        renderGroupChat();
      }
    }
  });
  chatSocket.on("message:recalled", ({ messageId }) => {
    recallMessage(messageId);
    renderMessages();
  });
  chatSocket.on("typing:update", ({ userId, typing } = {}) => {
    showTypingIndicator(userId, typing);
  });
  chatSocket.on("presence:update", (payload = {}) => {
    const { userId, online } = payload;
    if (!userId) return;
    if (online) onlineUserIds.add(userId);
    else onlineUserIds.delete(userId);
    updateOnlineFriends(payload);
    renderOnlineFriendsOverlay();
    if (currentPage === "friends") renderFriends();
    updateChatPresenceLabel();
  });
  chatSocket.on("friend:request:new", () => {
    refreshFriendsRealtime();
  });
  chatSocket.on("friend:request:accepted", () => {
    refreshFriendsRealtime();
    showToast(ui("好友請求已接受。", "Friend request accepted."));
  });
  chatSocket.on("friend:request:rejected", () => {
    refreshFriendsRealtime();
    showToast(ui("好友請求被拒絕。", "Friend request rejected."));
  });
  chatSocket.on("friends:updated", () => {
    refreshFriendsRealtime();
  });
  chatSocket.on("shared-task:new", () => {
    refreshFriendsRealtime();
    showToast(ui("您有新的共享任務。", "You have a new shared task."));
  });
  chatSocket.on("shared-task:accepted", () => {
    refreshFriendsRealtime();
    showToast(ui("共享任務已被接受。", "Shared task accepted."));
  });
  chatSocket.on("shared-task:rejected", () => {
    refreshFriendsRealtime();
    showToast(ui("共享任務已被拒絕。", "Shared task rejected."));
  });
  chatSocket.on("focus-room:updated", (room) => {
    updateActiveFocusRoom(room);
    refreshFriendsRealtime();
    showToast(ui("專注房間已更新。", "Focus room updated."));
  });
  chatSocket.on("chat:error", (payload) => {
    showToast(payload?.error || ui("聊天連線發生問題", "Chat connection issue"));
  });

  return chatSocket;
}

function disconnectChatSocket() {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = null;
  if (chatSocket) {
    chatSocket.disconnect();
    chatSocket = null;
  }
}

function isActiveDmMessage(message) {
  if (!message || !activeChatFriendId) return false;
  return (message.senderId === authState.user?.id && message.receiverId === activeChatFriendId)
    || (message.senderId === activeChatFriendId && message.receiverId === authState.user?.id);
}

function isActiveGroupMessage(message) {
  if (!message || !activeGroupId) return false;
  return message.roomId === `group_${activeGroupId}`;
}

function addOrUpdateMessage(message) {
  const normalized = {
    ...message,
    content: message?.content || "",
    imageUrl: message?.imageUrl || ""
  };
  const index = activeMessages.findIndex((item) => item.id === normalized.id);
  if (index >= 0) activeMessages[index] = normalized;
  else activeMessages.push(normalized);
  activeMessages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  friendsState.messages = activeMessages;
}

function recallMessage(messageId) {
  const message = activeMessages.find(m => m.id === messageId);
  if (message) {
    message.recalledAt = new Date().toISOString();
    message.content = "";
    message.imageUrl = "";
  }
}

function getMessageImageUrl(imageUrl) {
  return resolveAssetUrl(imageUrl);
}

function updateChatPresenceLabel() {
  const label = $("chatPresenceLabel");
  if (!label) return;
  const friendId = activeChatFriendId || friendsState.selectedFriendId;
  const online = friendId && onlineUserIds.has(friendId);
  label.textContent = online ? ui("在線", "Online") : ui("離線", "Offline");
  label.classList.toggle("online", Boolean(online));
}

function shouldIgnoreTabOverlay() {
  const tag = document.activeElement?.tagName?.toLowerCase();
  return ["input", "textarea", "select"].includes(tag) || document.activeElement?.isContentEditable;
}

function showOnlineFriendsOverlay() {
  if (isOnlineOverlayVisible) return;
  const overlay = $("onlineFriendsOverlay");
  if (!overlay) return;
  if (shouldIgnoreTabOverlay()) return;
  isOnlineOverlayVisible = true;
  overlay.classList.remove("hidden");
  renderOnlineFriendsOverlay();
}

function hideOnlineFriendsOverlay() {
  const overlay = $("onlineFriendsOverlay");
  if (!overlay) return;
  isOnlineOverlayVisible = false;
  overlay.classList.add("hidden");
}

function updateOnlineFriends(payload = {}) {
  const userId = String(payload.userId || "");
  const online = Boolean(payload.online);
  if (!userId) return;
  if (online) {
    onlineUserIds.add(userId);
  } else {
    onlineUserIds.delete(userId);
  }
  onlineFriends = friendsState.friends.filter((friend) => onlineUserIds.has(friend.id));
}

function renderOnlineFriendsOverlay() {
  const overlay = $("onlineFriendsOverlay");
  const countLabel = $("onlineFriendsCount");
  const list = $("onlineFriendsList");
  if (!overlay || !countLabel || !list) return;

  const activeFriends = friendsState.friends.filter((friend) => onlineUserIds.has(friend.id) || friend.online);

  countLabel.textContent = String(activeFriends.length);
  list.innerHTML = activeFriends.length
    ? activeFriends.map((friend) => `
        <li class="online-friend-item">
          <strong>${escapeHtml(friend.originalName || friend.name)}</strong>
          <span>${ui("在線中", "Online")}</span>
        </li>
      `).join("")
    : `<li class="online-friend-item empty-state">${ui("目前沒有在線好友。", "No online friends.")}</li>`;
}

function refreshFriendsRealtime() {
  if (authState.mode !== "user") return;
  Promise.allSettled([
    fetchFriends(),
    fetchFriendRequests(),
    fetchIncomingSharedTasks(),
    activeChatFriendId ? fetchMessages(activeChatFriendId) : Promise.resolve(),
    activeFocusFriendId ? pollFocusRoom(activeFocusFriendId, true) : Promise.resolve()
  ]).then(() => {
    if (currentPage === "friends") renderFriends();
  });
}

function startFriendsRealtimePolling() {
  if (friendsRealtimeTimer || authState.mode !== "user") return;
  if (chatSocket?.connected) return;
  refreshFriendsRealtime();
  friendsRealtimeTimer = setInterval(() => {
    if (chatSocket?.connected) {
      stopFriendsRealtimePolling();
      return;
    }
    refreshFriendsRealtime();
  }, 5000);
}

function stopFriendsRealtimePolling() {
  if (!friendsRealtimeTimer) return;
  clearInterval(friendsRealtimeTimer);
  friendsRealtimeTimer = null;
}

function updateActiveFocusRoom(room) {
  friendsState.focusRoom = room || null;
  if (currentPage === "friends") renderFriends();
}

async function joinDm(friendId) {
  if (!friendId) return;
  if (authState.mode !== "user") {
    renderMessages();
    return;
  }
  activeChatFriendId = friendId;
  activeMessages = [];
  friendsState.messages = activeMessages;
  connectChatSocket();
  if (chatSocket?.connected) chatSocket.emit("join:dm", { friendId });
  await fetchMessages(friendId);
  updateChatPresenceLabel();
  renderMessages();
}

function sendChatMessage() {
  const input = $("chatInput");
  const content = input?.value.trim() || "";
  if (!content) return;
  if (activeGroupId) {
    sendGroupMessage(activeGroupId, content, "text");
  } else {
    sendMessage(activeChatFriendId, content, "text");
  }
  if (input) input.value = "";
  if (chatSocket?.connected && activeChatFriendId) chatSocket.emit("typing:stop", { friendId: activeChatFriendId });
}

function sendQuickMessage(content) {
  if (activeGroupId) {
    sendGroupMessage(activeGroupId, content, "quick");
  } else {
    sendMessage(activeChatFriendId, content, "quick");
  }
}

async function handleImageUpload(file) {
  if (activeGroupId) {
    await handleGroupImageUpload(file);
  } else {
    if (!activeChatFriendId) return alert(ui("請先選擇好友。", "Choose a friend first."));
    if (authState.mode !== "user") return alert(ui("請先登入。", "Please sign in first."));
    if (!file) return;
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedTypes.has(file.type)) return alert(ui("只允許 JPG、PNG、WebP 或 GIF 圖片。", "Only JPG, PNG, WebP, or GIF images are allowed."));
    if (file.size > 10 * 1024 * 1024) return alert(ui("圖片大小不可超過 10MB。", "Image size cannot exceed 10MB."));

    const form = new FormData();
    form.append("friendId", activeChatFriendId);
    form.append("image", file);
    try {
      const res = await fetch(`${API_BASE}/messages/upload-image`, {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
        body: form
      });
      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.message) {
        addOrUpdateMessage(data.message);
        renderMessages();
      }
    } catch (err) {
      alert(ui(`圖片上傳失敗：${err.message}`, `Image upload failed: ${err.message}`));
    }
  }
}

function showTypingIndicator(userId, typing) {
  const indicator = $("typingIndicator");
  if (!indicator || userId === authState.user?.id) return;
  indicator.classList.toggle("hidden", !typing);
}

function sendGroupChatMessage() {
  const input = $("groupChatInput");
  const content = input?.value.trim() || "";
  if (!content || !groupsState.selectedGroupId) return;
  sendGroupMessage(groupsState.selectedGroupId, content, "text");
  if (input) input.value = "";
}

function selectFriend(friendId) {
  const changed = friendsState.selectedFriendId !== friendId;
  if (changed) {
    friendsState.messages = [];
    activeChatFriendId = null;
    activeMessages = [];
    friendsState.focusRoom = null;
    if (friendsState.focusPollFriendId !== friendId) stopFocusRoomPolling();
    showTypingIndicator(null, false);
  }
  friendsState.selectedFriendId = friendId;
  const friend = selectedFriend();
  if (!friend) return;
  const nickname = $("friendNicknameInput");
  const note = $("friendNoteInput");
  if (nickname) nickname.value = friend.nickname || "";
  if (note) note.value = friend.note || "";
}

async function fetchFriends() {
  if (authState.mode !== "user") {
    friendsState.friends = [];
    return [];
  }
  const data = await authenticatedApiRequest("/friends/list");
  friendsState.friends = Array.isArray(data.friends) ? data.friends : [];
  console.log("[groups] friends", friendsState.friends);
  if (friendsState.selectedFriendId && !friendsState.friends.some((friend) => friend.id === friendsState.selectedFriendId)) {
    friendsState.selectedFriendId = null;
    friendsState.messages = [];
    friendsState.focusRoom = null;
  }
  return friendsState.friends;
}

async function fetchFriendRequests() {
  if (authState.mode !== "user") {
    friendsState.requests = { incoming: [], outgoing: [] };
    return friendsState.requests;
  }
  const data = await authenticatedApiRequest("/friends/requests");
  friendsState.requests = {
    incoming: Array.isArray(data.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data.outgoing) ? data.outgoing : []
  };
  return friendsState.requests;
}

async function deleteMessageForMe(messageId) {
  try {
    await authenticatedApiRequest(`/messages/${encodeURIComponent(messageId)}/delete-for-me`, {
      method: "POST"
    });
    // 重新渲染以隱藏訊息
    renderMessages();
  } catch (err) {
    alert(ui(`刪除訊息失敗：${err.message}`, `Delete message failed: ${err.message}`));
  }
}

async function recallMessage(messageId) {
  try {
    await authenticatedApiRequest(`/messages/${encodeURIComponent(messageId)}/recall`, {
      method: "POST"
    });
    // 重新渲染會由 socket 事件處理
  } catch (err) {
    alert(ui(`收回訊息失敗：${err.message}`, `Recall message failed: ${err.message}`));
  }
}

async function sendFriendRequest() {
  if (authState.mode !== "user") return alert(ui("請先登入。", "Please sign in first."));
  const input = $("friendInviteEmail");
  const value = input?.value.trim();
  if (!value) return;
  const payload = value.includes("@") ? { email: value } : { friendId: value };
  try {
    await authenticatedApiRequest("/friends/request", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    input.value = "";
    await fetchFriendRequests();
    renderFriendsContent();
    showToast(ui("好友邀請已送出", "Friend request sent"));
  } catch (err) {
    alert(ui(`送出邀請失敗：${err.message}`, `Could not send request: ${err.message}`));
  }
}

async function acceptFriendRequest(friendId) {
  try {
    await authenticatedApiRequest("/friends/accept", {
      method: "POST",
      body: JSON.stringify({ friendId })
    });
    await Promise.all([fetchFriends(), fetchFriendRequests()]);
    renderFriendsContent();
    showToast(ui("已接受好友邀請", "Friend request accepted"));
  } catch (err) {
    alert(ui(`接受失敗：${err.message}`, `Accept failed: ${err.message}`));
  }
}

async function rejectFriendRequest(friendId) {
  try {
    await authenticatedApiRequest("/friends/reject", {
      method: "POST",
      body: JSON.stringify({ friendId })
    });
    await fetchFriendRequests();
    renderFriendsContent();
    showToast(ui("已拒絕好友邀請", "Friend request rejected"));
  } catch (err) {
    alert(ui(`拒絕失敗：${err.message}`, `Reject failed: ${err.message}`));
  }
}

async function updateFriendMeta() {
  const friend = selectedFriend();
  if (!friend) return alert(ui("請先選擇好友。", "Choose a friend first."));
  try {
    await authenticatedApiRequest("/friends/meta", {
      method: "POST",
      body: JSON.stringify({
        friendId: friend.id,
        nickname: $("friendNicknameInput")?.value || "",
        note: $("friendNoteInput")?.value || ""
      })
    });
    await fetchFriends();
    selectFriend(friend.id);
    renderFriendsContent();
    showToast(ui("好友設定已儲存", "Friend settings saved"));
  } catch (err) {
    alert(ui(`儲存失敗：${err.message}`, `Save failed: ${err.message}`));
  }
}

async function openChat(friendId) {
  selectFriend(friendId);
  await joinDm(friendId);
  renderFriendsContent();
}

async function fetchMessages(friendId) {
  if (!friendId || authState.mode !== "user") {
    activeMessages = [];
    friendsState.messages = [];
    return [];
  }
  const data = await authenticatedApiRequest(`/messages/${encodeURIComponent(friendId)}`);
  activeMessages = Array.isArray(data.messages) ? data.messages : [];
  friendsState.messages = activeMessages;
  return activeMessages;
}

async function sendMessage(friendId, content, type = "text") {
  if (!friendId) return alert(ui("請先選擇好友。", "Choose a friend first."));
  const message = String(content || "").trim();
  if (!message) return;
  try {
    connectChatSocket();
    if (chatSocket?.connected) {
      chatSocket.emit("message:send", { friendId, content: message, type });
    } else {
      const data = await authenticatedApiRequest("/messages/send", {
        method: "POST",
        body: JSON.stringify({ friendId, content: message, type })
      });
      if (data.message) addOrUpdateMessage(data.message);
      renderMessages();
    }
  } catch (err) {
    alert(ui(`訊息送出失敗：${err.message}`, `Message failed: ${err.message}`));
  }
}

async function joinGroup(groupId) {
  if (!groupId) return;
  if (authState.mode !== "user") {
    renderGroupMessages();
    return;
  }
  activeGroupId = groupId;
  activeGroupMessages = [];
  connectChatSocket();
  if (chatSocket?.connected) chatSocket.emit("join:group", { groupId });
  await fetchGroupMessages(groupId);
  renderGroupMessages();
}

async function fetchGroupMessages(groupId) {
  if (!groupId || authState.mode !== "user") {
    activeGroupMessages = [];
    return [];
  }
  const data = await authenticatedApiRequest(`/groups/${encodeURIComponent(groupId)}/messages`);
  activeGroupMessages = Array.isArray(data.messages) ? data.messages : [];
  return activeGroupMessages;
}

async function sendGroupMessage(groupId, content, type = "text") {
  if (!groupId) return alert(ui("請先選擇群組。", "Choose a group first."));
  const message = String(content || "").trim();
  if (!message) return;
  try {
    connectChatSocket();
    if (chatSocket?.connected) {
      chatSocket.emit("group:message:send", { groupId, content: message, type });
      // 樂觀更新
      const optimisticMessage = {
        id: Date.now().toString(),
        senderId: authState.user?.id,
        senderName: authState.user?.name,
        content: message,
        type,
        createdAt: new Date().toISOString()
      };
      groupsState.groupMessages.push(optimisticMessage);
      renderGroupChat();
    } else {
      // 如果 Socket.IO 不可用，可以考慮添加 HTTP API 備用方案
      alert(ui("即時聊天連線中斷，請重新整理頁面", "Real-time chat connection lost, please refresh the page"));
    }
  } catch (err) {
    alert(ui(`訊息送出失敗：${err.message}`, `Message failed: ${err.message}`));
  }
}

async function handleGroupImageUpload(file) {
  const groupId = groupsState.selectedGroupId || activeGroupId;
  if (!groupId) return showToast(ui("請先選擇群組。", "Choose a group first."));
  if (authState.mode !== "user") return showToast(ui("請先登入。", "Please sign in first."));
  if (!file) return;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowedTypes.has(file.type)) return showToast(ui("只允許 JPG、PNG、WebP 或 GIF 圖片。", "Only JPG, PNG, WebP, or GIF images are allowed."));
  if (file.size > 10 * 1024 * 1024) return showToast(ui("圖片大小不可超過 10MB。", "Image size cannot exceed 10MB."));

  const form = new FormData();
  form.append("image", file);
  try {
    const res = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/upload-image`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: form
    });
    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    console.log("[groups] upload image response", data.message);
    if (data.message) {
      if (groupId === activeGroupId) {
        addOrUpdateGroupMessage(data.message);
        renderGroupMessages();
      } else {
        groupsState.groupMessages = groupsState.groupMessages || [];
        groupsState.groupMessages.push(data.message);
        renderGroupChat();
      }
    }
  } catch (err) {
    showToast(ui(`群組圖片上傳失敗：${err.message}`, `Group image upload failed: ${err.message}`));
    console.error("群組圖片上傳失敗:", err);
  }
}

function addOrUpdateGroupMessage(message) {
  const normalized = {
    ...message,
    content: message?.content || "",
    imageUrl: message?.imageUrl || ""
  };
  const index = activeGroupMessages.findIndex((item) => item.id === normalized.id);
  if (index >= 0) activeGroupMessages[index] = normalized;
  else activeGroupMessages.push(normalized);
  activeGroupMessages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function addOrUpdateGroupsMessage(message) {
  const normalized = {
    ...message,
    content: message?.content || "",
    imageUrl: message?.imageUrl || "",
    senderName: message?.senderName || ui("未知", "Unknown")
  };
  const index = groupsState.groupMessages.findIndex((item) => item.id === normalized.id);
  if (index >= 0) groupsState.groupMessages[index] = normalized;
  else groupsState.groupMessages.push(normalized);
  groupsState.groupMessages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function recallGroupMessage(messageId) {
  const message = activeGroupMessages.find(m => m.id === messageId);
  if (message) {
    message.recalledAt = new Date().toISOString();
    message.content = "";
    message.imageUrl = "";
  }
}

function recallGroupsMessage(messageId) {
  const message = groupsState.groupMessages.find(m => m.id === messageId);
  if (message) {
    message.recalledAt = new Date().toISOString();
    message.content = "";
    message.imageUrl = "";
  }
}

function renderGroupMessages() {
  const list = $("messageList");
  if (!list) return;
  if (!activeGroupId) {
    list.innerHTML = `<p class="empty-state">${authState.mode === "user" ? ui("請先從群組列表選擇聊天對象。", "Choose a group from the list first.") : ui("請先登入才能使用聊天。", "Sign in to use chat.")}</p>`;
    return;
  }
  if (!activeGroupMessages.length) {
    list.innerHTML = `<p class="empty-state">${ui("還沒有訊息，傳一個訊息開始。", "No messages yet. Send a message to start.")}</p>`;
    return;
  }
  list.innerHTML = activeGroupMessages.map((message) => {
    const isMe = message.senderId === authState.user?.id;
    if (message.deletedFor && message.deletedFor.includes(authState.user?.id)) return "";
    const recalled = message.recalledAt;
    const imageUrl = getMessageImageUrl(message.imageUrl);
    const imageHtml = !recalled && message.type === "image" && imageUrl
      ? `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener"><img class="message-image" src="${escapeHtml(imageUrl)}" alt="${ui("聊天圖片", "Chat image")}" /></a>`
      : "";
    const contentHtml = recalled ? `<p>${ui("此訊息已收回", "This message was recalled")}</p>` : message.content ? `<p>${escapeHtml(message.content)}</p>` : "";
    const deleteBtn = !recalled ? `<button class="message-action delete-btn" data-message-id="${message.id}" type="button">${ui("刪除", "Delete")}</button>` : "";
    const recallBtn = isMe && !recalled ? `<button class="message-action recall-btn" data-message-id="${message.id}" type="button">${ui("收回", "Recall")}</button>` : "";
    return `
      <div class="message-bubble ${isMe ? "me" : "friend"}">
        ${imageHtml}
        ${contentHtml}
        <span>${message.type === "image" ? ui("圖片", "Image") : message.type === "quick" ? ui("快速訊息", "Quick") : ui("文字", "Text")} · ${formatDateTime(message.createdAt)}</span>
        ${deleteBtn}${recallBtn}
      </div>
    `;
  }).join("").replace(/<div class="message-bubble[^>]*><\/div>/g, "");
  list.scrollTop = list.scrollHeight;

  // 新增事件監聽器
  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.onclick = () => deleteMessageForMe(btn.dataset.messageId);
  });
  list.querySelectorAll(".recall-btn").forEach(btn => {
    btn.onclick = () => recallMessage(btn.dataset.messageId);
  });
}

function renderMessages() {
  const list = $("messageList");
  if (!list) return;

  // 如果是群組聊天，使用群組訊息渲染
  if (activeGroupId) {
    renderGroupMessages();
    return;
  }

  const friend = selectedFriend();
  if (!friend) {
    list.innerHTML = `<p class="empty-state">${authState.mode === "user" ? ui("請先從好友列表選擇聊天對象。", "Choose a friend from the list first.") : ui("請先登入才能使用聊天。", "Sign in to use chat.")}</p>`;
    return;
  }
  if (!activeMessages.length) {
    list.innerHTML = `<p class="empty-state">${ui("還沒有訊息，傳一個快速訊息開始。", "No messages yet. Send a quick message to start.")}</p>`;
    return;
  }
  list.innerHTML = activeMessages.map((message) => {
    const isMe = message.senderId === authState.user?.id;
    if (message.deletedFor && message.deletedFor.includes(authState.user?.id)) return "";
    const recalled = message.recalledAt;
    const imageUrl = getMessageImageUrl(message.imageUrl);
    const imageHtml = !recalled && message.type === "image" && imageUrl
      ? `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener"><img class="message-image" src="${escapeHtml(imageUrl)}" alt="${ui("聊天圖片", "Chat image")}" /></a>`
      : "";
    const contentHtml = recalled ? `<p>${ui("此訊息已收回", "This message was recalled")}</p>` : message.content ? `<p>${escapeHtml(message.content)}</p>` : "";
    const deleteBtn = !recalled ? `<button class="message-action delete-btn" data-message-id="${message.id}" type="button">${ui("刪除", "Delete")}</button>` : "";
    const recallBtn = isMe && !recalled ? `<button class="message-action recall-btn" data-message-id="${message.id}" type="button">${ui("收回", "Recall")}</button>` : "";
    return `
      <div class="message-bubble ${isMe ? "me" : "friend"}">
        ${imageHtml}
        ${contentHtml}
        <span>${message.type === "image" ? ui("圖片", "Image") : message.type === "quick" ? ui("快速訊息", "Quick") : ui("文字", "Text")} · ${formatDateTime(message.createdAt)}</span>
        ${deleteBtn}${recallBtn}
      </div>
    `;
  }).join("").replace(/<div class="message-bubble[^>]*><\/div>/g, "");
  list.scrollTop = list.scrollHeight;

  // 新增事件監聽器
  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.onclick = () => deleteMessageForMe(btn.dataset.messageId);
  });
  list.querySelectorAll(".recall-btn").forEach(btn => {
    btn.onclick = () => recallMessage(btn.dataset.messageId);
  });
}

async function shareTaskWithFriend(friendId, taskId) {
  if (!friendId) return alert(ui("請先選擇好友。", "Choose a friend first."));
  if (!taskId) return alert(ui("請先選擇要分享的任務。", "Choose a task to share first."));
  try {
    await authenticatedApiRequest("/tasks/share", {
      method: "POST",
      body: JSON.stringify({ friendId, taskId })
    });
    showToast(ui("任務已分享給好友", "Task shared with friend"));
  } catch (err) {
    alert(ui(`分享失敗：${err.message}`, `Share failed: ${err.message}`));
  }
}

async function fetchIncomingSharedTasks() {
  if (authState.mode !== "user") {
    friendsState.sharedTasks = [];
    return [];
  }
  const data = await authenticatedApiRequest("/tasks/shared/incoming");
  friendsState.sharedTasks = Array.isArray(data.shares) ? data.shares : [];
  return friendsState.sharedTasks;
}

async function acceptSharedTask(shareId) {
  try {
    await authenticatedApiRequest("/tasks/shared/accept", {
      method: "POST",
      body: JSON.stringify({ shareId })
    });
    await loadUserDataFromServer();
    await fetchIncomingSharedTasks();
    renderFriendsContent();
    showToast(ui("已接受共享任務並加入你的任務清單", "Shared task accepted and added to your task list"));
  } catch (err) {
    alert(ui(`接受共享任務失敗：${err.message}`, `Accept shared task failed: ${err.message}`));
  }
}

async function rejectSharedTask(shareId) {
  try {
    await authenticatedApiRequest("/tasks/shared/reject", {
      method: "POST",
      body: JSON.stringify({ shareId })
    });
    await fetchIncomingSharedTasks();
    renderFriendsContent();
    showToast(ui("已拒絕共享任務", "Shared task rejected"));
  } catch (err) {
    alert(ui(`拒絕共享任務失敗：${err.message}`, `Reject shared task failed: ${err.message}`));
  }
}

async function createFocusRoom(friendId) {
  if (!friendId) return alert(ui("請先選擇好友。", "Choose a friend first."));
  try {
    selectFriend(friendId);
    const durationMinutes = Number($("focusRoomMinutesInput")?.value) || appData.settings.focusMinutes || 25;
    const data = await authenticatedApiRequest("/focus-room/create", {
      method: "POST",
      body: JSON.stringify({ friendId, durationMinutes })
    });
    friendsState.focusRoom = data.room;
    renderFriendsContent();
    pollFocusRoom(friendId);
    showToast(ui("已邀請好友一起專注", "Focus invitation sent"));
  } catch (err) {
    alert(ui(`建立一起專注失敗：${err.message}`, `Could not create focus room: ${err.message}`));
  }
}

async function openFocusRoom(friendId) {
  if (!friendId) return;
  selectFriend(friendId);
  try {
    const room = await fetchActiveFocusRoom(friendId);
    renderFriendsContent();
    if (room) pollFocusRoom(friendId);
    else await createFocusRoom(friendId);
  } catch (err) {
    alert(ui(`取得一起專注失敗：${err.message}`, `Could not open focus room: ${err.message}`));
  }
}

async function fetchActiveFocusRoom(friendId) {
  if (!friendId || authState.mode !== "user") return null;
  const data = await authenticatedApiRequest(`/focus-room/active/${encodeURIComponent(friendId)}`);
  friendsState.focusRoom = data.room || null;
  return friendsState.focusRoom;
}

function pollFocusRoom(friendId, once = false) {
  if (!friendId) return;
  activeFocusFriendId = friendId;
  if (once) {
    fetchActiveFocusRoom(friendId).then((room) => {
      if (friendsState.focusPollFriendId !== friendId && !room) return;
      renderFocusRoom(room);
    }).catch(() => {});
    return;
  }

  stopFocusRoomPolling();
  friendsState.focusPollFriendId = friendId;
  const tick = async () => {
    try {
      const room = await fetchActiveFocusRoom(friendId);
      if (friendsState.focusPollFriendId !== friendId) return;
      renderFocusRoom(room);
      if (!room || room.status === "ended") stopFocusRoomPolling();
    } catch (_) {
      stopFocusRoomPolling();
    }
  };
  tick();
  friendsState.focusPollTimer = setInterval(tick, 2000);
}

function getFocusRoomRemaining(room) {
  if (!room) return 0;
  const total = Math.max(1, Number(room.durationMinutes) || 25) * 60;
  if (room.status === "running" && room.startedAt) {
    const elapsed = Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000);
    return Math.max(0, total - elapsed);
  }
  return Math.max(0, Number(room.pausedRemainingSeconds ?? room.remainingSeconds ?? total));
}

async function updateFocusRoom(action) {
  const room = friendsState.focusRoom;
  const friend = selectedFriend();
  if (!room || !friend) return;
  try {
    await authenticatedApiRequest(`/focus-room/${action}`, {
      method: "POST",
      body: JSON.stringify({ roomId: room.id })
    });
    await fetchActiveFocusRoom(friend.id);
    renderFocusRoom(friendsState.focusRoom);
    if (action === "end") stopFocusRoomPolling();
    else pollFocusRoom(friend.id);
  } catch (err) {
    alert(ui(`更新一起專注失敗：${err.message}`, `Focus room update failed: ${err.message}`));
  }
}

async function joinFocusRoom() {
  const room = friendsState.focusRoom;
  const friend = selectedFriend();
  if (!room || !friend) return;
  try {
    await authenticatedApiRequest("/focus-room/join", {
      method: "POST",
      body: JSON.stringify({ roomId: room.id })
    });
    await fetchActiveFocusRoom(friend.id);
    renderFocusRoom(friendsState.focusRoom);
    pollFocusRoom(friend.id);
  } catch (err) {
    alert(ui(`加入一起專注失敗：${err.message}`, `Could not join focus room: ${err.message}`));
  }
}

function renderFocusRoom(room) {
  const panel = $("focusRoomPanel");
  if (!panel) return;
  const friend = selectedFriend();
  if (!friend) {
    panel.className = "focus-room-card empty-state";
    panel.textContent = ui("請先選擇好友。", "Choose a friend first.");
    return;
  }
  if (!room) {
    panel.className = "focus-room-card empty-state";
    panel.textContent = ui("尚未建立一起專注房間。", "No focus room yet.");
    return;
  }

  const participantNames = (room.participantIds || []).map((id) => {
    if (id === authState.user?.id) return ui("你", "You");
    if (id === friend.id) return friendDisplayName(friend);
    return id;
  });
  const invitedNames = (room.invitedUserIds || []).map((id) => {
    if (id === authState.user?.id) return ui("你", "You");
    if (id === friend.id) return friendDisplayName(friend);
    return id;
  });
  const isParticipant = room.participantIds?.includes(authState.user?.id);
  const isInvited = room.invitedUserIds?.includes(authState.user?.id);

  panel.className = "focus-room-card";
  panel.innerHTML = `
    <div class="focus-room-timer">${formatTimer(getFocusRoomRemaining(room))}</div>
    <div class="task-meta">
      <span>${ui("狀態", "Status")}: ${escapeHtml(room.status)}</span>
      <span>${ui("時長", "Duration")}: ${Number(room.durationMinutes) || 25} ${ui("分", "min")}</span>
      <span>${ui("參與者", "Participants")}: ${escapeHtml(participantNames.join(", ") || "-")}</span>
      ${invitedNames.length ? `<span>${ui("已邀請", "Invited")}: ${escapeHtml(invitedNames.join(", "))}</span>` : ""}
    </div>
    <div class="button-row focus-room-actions">
      ${isInvited ? `<button id="joinFocusRoomBtn" type="button">${ui("加入", "Join")}</button>` : ""}
      ${isParticipant ? `<button id="focusRoomStartBtn" type="button">${ui("開始", "Start")}</button>` : ""}
      ${isParticipant ? `<button id="focusRoomPauseBtn" class="secondary" type="button">${ui("暫停", "Pause")}</button>` : ""}
      ${isParticipant ? `<button id="focusRoomResetBtn" class="secondary" type="button">${ui("重設", "Reset")}</button>` : ""}
      ${isParticipant ? `<button id="focusRoomEndBtn" class="danger" type="button">${ui("結束", "End")}</button>` : ""}
    </div>
  `;
  $("joinFocusRoomBtn")?.addEventListener("click", joinFocusRoom);
  $("focusRoomStartBtn")?.addEventListener("click", () => updateFocusRoom("start"));
  $("focusRoomPauseBtn")?.addEventListener("click", () => updateFocusRoom("pause"));
  $("focusRoomResetBtn")?.addEventListener("click", () => updateFocusRoom("reset"));
  $("focusRoomEndBtn")?.addEventListener("click", () => updateFocusRoom("end"));
}

function renderFriendsContent() {
  const friendList = $("friendList");
  const groupList = $("groupList");
  const listTitle = $("listTitle");
  const toggleBtn = $("toggleFriendGroupBtn");

  if (!friendList || !groupList || !listTitle || !toggleBtn) return;

  const signedIn = authState.mode === "user";

  if (!signedIn) {
    friendList.innerHTML = `<p class="empty-state">${ui("請先登入才能使用 Friends+。", "Sign in to use Friends+.")}</p>`;
    groupList.innerHTML = "";
    $("friendRequestsList").innerHTML = "";
    $("incomingSharedTasks").innerHTML = "";
    renderMessages();
    renderFocusRoom(null);
    return;
  }

  // 更新切換按鈕文字
  toggleBtn.textContent = isShowingGroups ? ui("切換到好友", "Switch to Friends") : ui("切換到群組", "Switch to Groups");
  listTitle.textContent = isShowingGroups ? ui("我的群組", "My Groups") : ui("我的好友", "My Friends");

  if (isShowingGroups) {
    // 顯示群組列表
    friendList.classList.add("hidden");
    groupList.classList.remove("hidden");
    renderGroupsList();

    // 隱藏任務共享和一起專注面板，因為群組不支援這些功能
    setText("#shareFriendName", ui("群組不支援任務共享", "Task sharing not available for groups"));
    setText("#focusRoomFriendName", ui("群組不支援一起專注", "Focus together not available for groups"));
  } else {
    // 顯示好友列表
    groupList.classList.add("hidden");
    friendList.classList.remove("hidden");
    renderFriendsList();
  }

  if (!friendsState.friends.length) {
    friendList.innerHTML = `<p class="empty-state">${ui("尚無好友。用 Email 送出第一個好友邀請。", "No friends yet. Send your first invite by email.")}</p>`;
  } else {
    friendList.innerHTML = friendsState.friends.map((item) => `
      <article class="friend-card ${item.id === friendsState.selectedFriendId ? "active" : ""}" data-friend-id="${escapeHtml(item.id)}">
        <div>
          <strong>${escapeHtml(item.originalName || item.name)}</strong>
          <p>${item.nickname ? `${ui("暱稱", "Nickname")}: ${escapeHtml(item.nickname)}` : ui("尚未設定暱稱", "No nickname set")}</p>
        </div>
        <div class="friend-stats">
          <span>${Number(item.today?.focusMinutes || 0)} ${ui("分", "min")}</span>
          <span>${Number(item.today?.completedTasks || 0)} ${ui("件完成", "done")}</span>
        </div>
        <div class="friend-actions">
          <button class="small friend-chat" type="button">${ui("聊天", "Chat")}</button>
          <button class="small secondary friend-share" type="button">${ui("共享任務", "Share task")}</button>
          <button class="small secondary friend-focus" type="button">${ui("一起專注", "Focus together")}</button>
          <button class="small secondary friend-meta" type="button">${ui("設定備註", "Notes")}</button>
        </div>
      </article>
    `).join("");
    friendList.querySelectorAll(".friend-card").forEach((card) => {
      const friendId = card.dataset.friendId;
      card.querySelector(".friend-chat").onclick = () => openChat(friendId);
      card.querySelector(".friend-share").onclick = () => { selectFriend(friendId); renderFriendsContent(); };
      card.querySelector(".friend-focus").onclick = () => openFocusRoom(friendId);
      card.querySelector(".friend-meta").onclick = () => { selectFriend(friendId); renderFriendsContent(); $("friendNicknameInput")?.focus(); };
    });
  }

  const requests = $("friendRequestsList");
  if (requests) {
    const incoming = friendsState.requests.incoming || [];
    const outgoing = friendsState.requests.outgoing || [];
    requests.innerHTML = `
      <div class="request-group">
        <h4>${ui("收到的邀請", "Incoming requests")}</h4>
        ${incoming.length ? incoming.map((item) => `
          <div class="settings-row request-row">
            <span>${escapeHtml(item.name)} · ${escapeHtml(item.email)}</span>
            <strong>
              <button class="small accept-request" data-id="${escapeHtml(item.id)}" type="button">${ui("接受", "Accept")}</button>
              <button class="small secondary reject-request" data-id="${escapeHtml(item.id)}" type="button">${ui("拒絕", "Reject")}</button>
            </strong>
          </div>
        `).join("") : `<p class="empty-state">${ui("沒有待回覆邀請。", "No incoming requests.")}</p>`}
      </div>
      <div class="request-group">
        <h4>${ui("已送出的邀請", "Outgoing requests")}</h4>
        ${outgoing.length ? outgoing.map((item) => `<p class="note">${escapeHtml(item.name)} · ${escapeHtml(item.email)}</p>`).join("") : `<p class="empty-state">${ui("沒有送出的邀請。", "No outgoing requests.")}</p>`}
      </div>
    `;
    requests.querySelectorAll(".accept-request").forEach((button) => {
      button.onclick = () => acceptFriendRequest(button.dataset.id);
    });
    requests.querySelectorAll(".reject-request").forEach((button) => {
      button.onclick = () => rejectFriendRequest(button.dataset.id);
    });
  }

  const taskSelect = $("shareTaskSelect");
  if (taskSelect) {
    const tasks = appData.tasks.filter((task) => task.status !== "done");
    taskSelect.innerHTML = `<option value="">${ui("選擇任務", "Choose a task")}</option>${tasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join("")}`;
  }

  const shared = $("incomingSharedTasks");
  if (shared) {
    shared.innerHTML = `
      <h4>${ui("收到的共享任務", "Incoming shared tasks")}</h4>
      ${friendsState.sharedTasks.length ? friendsState.sharedTasks.map((share) => `
        <article class="shared-task-card">
          <strong>${escapeHtml(share.taskSnapshot?.title || ui("未命名任務", "Untitled task"))}</strong>
          <p>${ui("來自", "From")}: ${escapeHtml(share.sender?.name || share.senderId)}</p>
          <div class="button-row">
            <button class="small accept-share" data-id="${escapeHtml(share.id)}" type="button">${ui("接受", "Accept")}</button>
            <button class="small secondary reject-share" data-id="${escapeHtml(share.id)}" type="button">${ui("拒絕", "Reject")}</button>
          </div>
        </article>
      `).join("") : `<p class="empty-state">${ui("目前沒有待處理的共享任務。", "No shared tasks waiting.")}</p>`}
    `;
    shared.querySelectorAll(".accept-share").forEach((button) => {
      button.onclick = () => acceptSharedTask(button.dataset.id);
    });
    shared.querySelectorAll(".reject-share").forEach((button) => {
      button.onclick = () => rejectSharedTask(button.dataset.id);
    });
  }

  renderMessages();
  renderFocusRoom(friendsState.focusRoom);
}

function renderFriendsList() {
  const friendList = $("friendList");
  if (!friendList) return;

  const friend = selectedFriend();
  setText("#friendCountLabel", String(friendsState.friends.length));
  setText("#chatFriendName", friend ? friendDisplayName(friend) : ui("請選擇好友", "Choose a friend"));
  setText("#shareFriendName", friend ? ui(`分享任務給 ${friendDisplayName(friend)}`, `Share a task with ${friendDisplayName(friend)}`) : ui("選擇好友分享任務", "Choose a friend to share a task"));
  setText("#focusRoomFriendName", friend ? ui(`和 ${friendDisplayName(friend)} 一起專注`, `Focus with ${friendDisplayName(friend)}`) : ui("選擇好友一起專注", "Choose a friend to focus together"));
  setText("#metaFriendName", friend ? ui(`設定 ${friendDisplayName(friend)}`, `Settings for ${friendDisplayName(friend)}`) : ui("選擇好友設定備註", "Choose a friend for notes"));
  updateChatPresenceLabel();

  if (!friendsState.friends.length) {
    friendList.innerHTML = `<p class="empty-state">${ui("尚無好友。用 Email 送出第一個好友邀請。", "No friends yet. Send your first invite by email.")}</p>`;
  } else {
    friendList.innerHTML = friendsState.friends.map((item) => `
      <article class="friend-card ${item.id === friendsState.selectedFriendId ? "active" : ""}" data-friend-id="${escapeHtml(item.id)}">
        <div>
          <strong>${escapeHtml(item.originalName || item.name)}</strong>
          <p>${item.nickname ? `${ui("暱稱", "Nickname")}: ${escapeHtml(item.nickname)}` : ui("尚未設定暱稱", "No nickname set")}</p>
        </div>
        <div class="friend-stats">
          <span>${Number(item.today?.focusMinutes || 0)} ${ui("分", "min")}</span>
          <span>${Number(item.today?.completedTasks || 0)} ${ui("件完成", "done")}</span>
        </div>
        <div class="friend-actions">
          <button class="small friend-chat" type="button">${ui("聊天", "Chat")}</button>
          <button class="small secondary friend-share" type="button">${ui("共享任務", "Share task")}</button>
          <button class="small secondary friend-focus" type="button">${ui("一起專注", "Focus together")}</button>
          <button class="small secondary friend-meta" type="button">${ui("設定備註", "Notes")}</button>
        </div>
      </article>
    `).join("");
    friendList.querySelectorAll(".friend-card").forEach((card) => {
      const friendId = card.dataset.friendId;
      card.querySelector(".friend-chat").onclick = () => openChat(friendId);
      card.querySelector(".friend-share").onclick = () => { selectFriend(friendId); renderFriendsContent(); };
      card.querySelector(".friend-focus").onclick = () => openFocusRoom(friendId);
      card.querySelector(".friend-meta").onclick = () => { selectFriend(friendId); renderFriendsContent(); $("friendNicknameInput")?.focus(); };
    });
  }
}

function renderGroupsList() {
  const groupList = $("groupList");
  if (!groupList) return;

  // 載入群組列表
  loadGroupsList().then((groups) => {
    setText("#friendCountLabel", String(groups.length));
    setText("#chatFriendName", activeGroupId ? ui(`群組聊天中`, "Group Chat") : ui("請選擇群組", "Choose a group"));

    if (!groups.length) {
      groupList.innerHTML = `<p class="empty-state">${ui("尚無群組。", "No groups yet.")}</p>`;
    } else {
      groupList.innerHTML = groups.map((group) => `
        <article class="friend-card ${group.id === activeGroupId ? "active" : ""}" data-group-id="${escapeHtml(group.id)}">
          <div>
            <strong>${escapeHtml(group.name)}</strong>
            <p>${ui("成員", "Members")}: ${group.members?.length || 0}</p>
          </div>
          <div class="friend-actions">
            <button class="small group-chat" type="button">${ui("聊天", "Chat")}</button>
          </div>
        </article>
      `).join("");
      groupList.querySelectorAll(".friend-card").forEach((card) => {
        const groupId = card.dataset.groupId;
        card.querySelector(".group-chat").onclick = () => openGroupChat(groupId);
      });
    }
  }).catch((err) => {
    console.error("載入群組列表失敗:", err);
    groupList.innerHTML = `<p class="empty-state">${ui("載入群組列表失敗。", "Failed to load groups.")}</p>`;
  });
}

async function loadGroupsList() {
  const response = await fetch(`${API_BASE}/groups/list`, {
    headers: { Authorization: `Bearer ${authState.token}` }
  });
  if (!response.ok) throw new Error("載入群組列表失敗");
  const data = await response.json();
  return data.groups || [];
}

function openGroupChat(groupId) {
  // 清除好友選擇
  friendsState.selectedFriendId = null;
  // 設定活躍群組
  activeGroupId = groupId;
  // 載入群組訊息
  fetchGroupMessages(groupId);
  // 加入群組聊天室
  joinGroup(groupId);
  // 重新渲染
  renderFriendsContent();
}

async function renderFriends() {
  const friendList = $("friendList");
  if (!friendList) return;
  if (authState.mode !== "user") {
    friendsState = { ...friendsState, friends: [], requests: { incoming: [], outgoing: [] }, messages: [], sharedTasks: [], focusRoom: null };
    groupsState = { groups: [], selectedGroupId: null, groupMessages: [], groupMembers: [] };
    renderFriendsContent();
    return;
  }
  friendList.innerHTML = `<p class="empty-state">${ui("載入 Friends+ 中...", "Loading Friends+...")}</p>`;
  try {
    await Promise.all([fetchFriends(), fetchFriendRequests(), fetchIncomingSharedTasks()]);
    renderFriendsContent();

    // 添加切換按鈕事件監聽器
    const toggleBtn = $("toggleFriendGroupBtn");
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        isShowingGroups = !isShowingGroups;
        renderFriendsContent();
      };
    }
  } catch (err) {
    friendList.innerHTML = `<p class="empty-state">${escapeHtml(ui(`好友資料載入失敗：${err.message}`, `Could not load friends: ${err.message}`))}</p>`;
  }
}

let groupsState = {
  groups: [],
  selectedGroupId: null,
  groupMessages: [],
  groupMembers: []
};

async function renderGroups() {
  const groupsList = $("groupsList");
  if (!groupsList) return;
  if (authState.mode !== "user") {
    groupsState = { groups: [], selectedGroupId: null, groupMessages: [], groupMembers: [] };
    renderGroupsContent();
    return;
  }
  groupsList.innerHTML = `<p class="empty-state">${ui("載入群組中...", "Loading groups...")}</p>`;
  try {
    await Promise.all([fetchGroups(), fetchFriends()]);
    renderGroupsContent();
  } catch (err) {
    groupsList.innerHTML = `<p class="empty-state">${escapeHtml(ui(`群組資料載入失敗：${err.message}`, `Could not load groups: ${err.message}`))}</p>`;
  }
}

function renderGroupsContent() {
  const groupsList = $("groupsList");
  const signedIn = authState.mode === "user";

  if (!signedIn) {
    groupsList.innerHTML = `<p class="empty-state">${ui("請先登入才能使用群組。", "Sign in to use groups.")}</p>`;
    renderGroupChat();
    renderGroupMembers();
    renderGroupSettings();
    return;
  }

  if (!groupsState.groups.length) {
    groupsList.innerHTML = `<p class="empty-state">${ui("尚無群組。用右上角按鈕建立第一個群組。", "No groups yet. Create your first group with the button above.")}</p>`;
  } else {
    groupsList.innerHTML = groupsState.groups.map((group) => `
      <article class="group-card ${group.id === groupsState.selectedGroupId ? "active" : ""}" data-group-id="${escapeHtml(group.id)}">
        <div>
          <strong>${escapeHtml(group.name)}</strong>
          <p>${escapeHtml(group.description || ui("無描述", "No description"))}</p>
          <span class="group-member-count">${ui("成員", "Members")}: ${group.members?.length || 0}</span>
        </div>
        <button class="small group-open-chat" type="button">${ui("開啟聊天", "Open Chat")}</button>
      </article>
    `).join("");
    groupsList.querySelectorAll(".group-card").forEach((card) => {
      const groupId = card.dataset.groupId;
      card.querySelector(".group-open-chat").onclick = () => openGroup(groupId);
    });
  }

  renderGroupChat();
  renderGroupMembers();
  renderGroupSettings();
}

async function fetchGroups() {
  const response = await fetch(`${API_BASE}/groups/list`, {
    headers: { Authorization: `Bearer ${authState.token}` }
  });
  if (!response.ok) throw new Error("載入群組列表失敗");
  const data = await response.json();
  groupsState.groups = data.groups || [];
  return groupsState.groups;
}

async function createGroup() {
  const name = $("groupNameInput").value.trim();
  const description = $("groupDescriptionInput").value.trim();
  if (!name) return alert(ui("請輸入群組名稱。", "Please enter a group name."));

  try {
    const response = await fetch(`${API_BASE}/groups/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) throw new Error("建立群組失敗");
    const data = await response.json();
    showToast(ui("群組建立成功", "Group created successfully"));
    await fetchGroups();
    renderGroupsContent();
    toggleCreateGroupForm(false);
  } catch (err) {
    alert(ui(`建立群組失敗：${err.message}`, `Create group failed: ${err.message}`));
  }
}

async function openGroup(groupId) {
  console.log("[groups] openGroup", groupId);
  groupsState.selectedGroupId = groupId;
  activeGroupId = groupId;
  await Promise.all([fetchFriends(), fetchGroupDetail(groupId)]);
  await joinGroup(groupId);
  renderGroupsContent();
}

async function fetchGroupDetail(groupId) {
  if (!groupId || authState.mode !== "user") return;
  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson.error || `HTTP ${response.status}`);
    }
    const group = await response.json();
    console.log("[groups] group detail", group);
    groupsState.groupDetail = group;
    groupsState.groupMembers = Array.isArray(group.members) ? group.members : [];
    await fetchGroupMessages(groupId);
  } catch (err) {
    groupsState.groupDetail = null;
    groupsState.groupMembers = [];
    showToast(ui(`群組詳情載入失敗：${err.message}`, `Failed to load group detail: ${err.message}`));
    console.error("載入群組詳情失敗:", err);
  }
}

async function fetchGroupMessages(groupId) {
  if (!groupId || authState.mode !== "user") {
    groupsState.groupMessages = [];
    return [];
  }
  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/messages`, {
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (!response.ok) throw new Error("載入群組訊息失敗");
    const data = await response.json();
    groupsState.groupMessages = Array.isArray(data.messages) ? data.messages : [];
  } catch (err) {
    console.error("載入群組訊息失敗:", err);
    groupsState.groupMessages = [];
  }
  return groupsState.groupMessages;
}

async function inviteFriendToGroup(groupId, friendId) {
  if (!groupId || !friendId) return showToast(ui("請選擇群組和好友。", "Please select a group and friend."));
  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ friendId })
    });
    if (!response.ok) {
      const errorJson = await response.json().catch(() => ({}));
      throw new Error(errorJson.error || `HTTP ${response.status}`);
    }
    showToast(ui("好友邀請已送出", "Friend invitation sent"));
    await openGroup(groupId);
  } catch (err) {
    showToast(ui(`邀請好友失敗：${err.message}`, `Invite friend failed: ${err.message}`));
    console.error("群組邀請失敗:", err);
  }
}

async function leaveGroup(groupId) {
  if (!groupId) return alert(ui("請選擇群組。", "Please select a group."));
  if (!confirm(ui("確定要離開這個群組嗎？", "Are you sure you want to leave this group?"))) return;
  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/leave`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    if (!response.ok) throw new Error("離開群組失敗");
    showToast(ui("已離開群組", "Left the group"));
    groupsState.selectedGroupId = null;
    await fetchGroups();
    renderGroupsContent();
  } catch (err) {
    alert(ui(`離開群組失敗：${err.message}`, `Leave group failed: ${err.message}`));
  }
}

async function updateGroup(groupId) {
  const name = $("editGroupNameInput").value.trim();
  const description = $("editGroupDescriptionInput").value.trim();
  if (!name) return alert(ui("請輸入群組名稱。", "Please enter a group name."));

  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) throw new Error("更新群組失敗");
    showToast(ui("群組更新成功", "Group updated successfully"));
    await fetchGroups();
    renderGroupsContent();
  } catch (err) {
    alert(ui(`更新群組失敗：${err.message}`, `Update group failed: ${err.message}`));
  }
}

async function removeGroupMember(groupId, memberId) {
  if (!groupId || !memberId) return alert(ui("請選擇群組和成員。", "Please select a group and member."));
  if (!confirm(ui("確定要移除這個成員嗎？", "Are you sure you want to remove this member?"))) return;
  try {
    const response = await fetch(`${API_BASE}/groups/${encodeURIComponent(groupId)}/remove-member`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authState.token}`
      },
      body: JSON.stringify({ userId: memberId })
    });
    if (!response.ok) throw new Error("移除成員失敗");
    showToast(ui("成員已移除", "Member removed"));
    await fetchGroupDetail(groupId);
    renderGroupMembers();
  } catch (err) {
    alert(ui(`移除成員失敗：${err.message}`, `Remove member failed: ${err.message}`));
  }
}

function renderGroupMembers(group) {
  const list = $("groupMembersList");
  const title = $("groupMembersTitle");
  const inviteSelect = $("inviteFriendSelect");
  if (!list || !title || !inviteSelect) return;

  if (!groupsState.selectedGroupId) {
    title.textContent = ui("請選擇群組", "Choose a group");
    list.innerHTML = `<p class="empty-state">${ui("請先選擇群組查看成員。", "Select a group to view members.")}</p>`;
    inviteSelect.innerHTML = `<option value="">${ui("請先選擇群組", "Choose a group first")}</option>`;
    return;
  }

  const activeGroup = group || groupsState.groupDetail || { members: groupsState.groupMembers };
  title.textContent = ui("群組成員", "Group Members");

  if (!Array.isArray(activeGroup.members)) {
    list.innerHTML = `<p class="empty-state">${ui("成員資料載入失敗", "Failed to load member data")}</p>`;
    inviteSelect.innerHTML = `<option value="">${ui("成員資料載入失敗", "Failed to load member data")}</option>`;
    return;
  }

  if (!activeGroup.members.length) {
    list.innerHTML = `<p class="empty-state">${ui("尚無成員。", "No members yet.")}</p>`;
    renderGroupInviteOptions(activeGroup, friendsState.friends);
    return;
  }

  const currentUserId = authState.user?.id;
  const isOwner = activeGroup.members.find((m) => m.id === currentUserId)?.isOwner;

  list.innerHTML = activeGroup.members.map((member) => `
    <div class="group-member-item">
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        ${member.isOwner ? `<span class="owner-badge">${ui("群主", "Owner")}</span>` : ""}
      </div>
      ${isOwner && member.id !== currentUserId ? `<button class="small danger remove-member-btn" data-member-id="${member.id}" type="button">${ui("移除", "Remove")}</button>` : ""}
    </div>
  `).join("");

  list.querySelectorAll(".remove-member-btn").forEach((btn) => {
    btn.onclick = () => removeGroupMember(groupsState.selectedGroupId, btn.dataset.memberId);
  });

  renderGroupInviteOptions(activeGroup, friendsState.friends);
}

function renderGroupInviteOptions(group, friends) {
  const inviteSelect = $("inviteFriendSelect");
  if (!inviteSelect) return;
  if (!group || !Array.isArray(group.members)) {
    inviteSelect.innerHTML = `<option value="">${ui("成員資料載入失敗", "Failed to load member data")}</option>`;
    return;
  }

  const memberIds = new Set(group.members.map((member) => member.id));
  const availableFriends = Array.isArray(friends) ? friends.filter((friend) => !memberIds.has(friend.id)) : [];
  inviteSelect.innerHTML = `<option value="">${ui("選擇好友...", "Choose a friend...")}</option>` +
    availableFriends.map((friend) => `<option value="${escapeHtml(friend.id)}">${escapeHtml(friend.originalName || friend.name)}</option>`).join("");
}

function renderGroupChat() {
  const list = $("groupMessageList");
  const title = $("groupChatTitle");
  if (!list || !title) return;

  if (!groupsState.selectedGroupId) {
    title.textContent = ui("請選擇群組", "Choose a group");
    list.innerHTML = `<p class="empty-state">${ui("請先選擇群組開始聊天。", "Select a group to start chatting.")}</p>`;
    return;
  }

  title.textContent = ui("群組聊天", "Group Chat");
  if (!groupsState.groupMessages.length) {
    list.innerHTML = `<p class="empty-state">${ui("還沒有訊息，傳一個訊息開始。", "No messages yet. Send a message to start.")}</p>`;
    return;
  }

  list.innerHTML = groupsState.groupMessages.map((message) => {
    const isMe = message.senderId === authState.user?.id;
    if (message.deletedFor && message.deletedFor.includes(authState.user?.id)) return "";
    const recalled = message.recalledAt;
    const imageUrl = getMessageImageUrl(message.imageUrl);
    const imageHtml = !recalled && message.type === "image" && imageUrl
      ? `<a href="${escapeHtml(imageUrl)}" target="_blank" rel="noopener"><img class="message-image" src="${escapeHtml(imageUrl)}" alt="${ui("聊天圖片", "Chat image")}" /></a>`
      : "";
    const contentHtml = recalled ? `<p>${ui("此訊息已收回", "This message was recalled")}</p>` : message.content ? `<p>${escapeHtml(message.content)}</p>` : "";
    const deleteBtn = isMe && !recalled ? `<button class="message-action delete-btn" data-message-id="${message.id}" type="button">${ui("刪除", "Delete")}</button>` : "";
    const recallBtn = isMe && !recalled ? `<button class="message-action recall-btn" data-message-id="${message.id}" type="button">${ui("收回", "Recall")}</button>` : "";
    return `
      <div class="group-message-bubble ${isMe ? "me" : "other"}">
        <div class="message-sender">${escapeHtml(message.senderName || ui("未知", "Unknown"))}</div>
        ${imageHtml}
        ${contentHtml}
        <span>${message.type === "image" ? ui("圖片", "Image") : ui("文字", "Text")} · ${formatDateTime(message.createdAt)}</span>
        ${deleteBtn}${recallBtn}
      </div>
    `;
  }).join("").replace(/<div class="group-message-bubble[^>]*><\/div>/g, "");
  list.scrollTop = list.scrollHeight;

  // 新增事件監聽器
  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.onclick = () => deleteMessageForMe(btn.dataset.messageId);
  });
  list.querySelectorAll(".recall-btn").forEach(btn => {
    btn.onclick = () => recallMessage(btn.dataset.messageId);
  });
}

function renderGroupSettings() {
  const form = $("groupSettingsForm");
  const title = $("groupSettingsTitle");
  if (!form || !title) return;

  if (!groupsState.selectedGroupId) {
    title.textContent = ui("請選擇群組", "Choose a group");
    form.classList.add("hidden");
    return;
  }

  const group = groupsState.groups.find(g => g.id === groupsState.selectedGroupId);
  if (!group) {
    title.textContent = ui("群組不存在", "Group not found");
    form.classList.add("hidden");
    return;
  }

  title.textContent = ui("群組設定", "Group Settings");
  form.classList.remove("hidden");
  $("editGroupNameInput").value = group.name || "";
  $("editGroupDescriptionInput").value = group.description || "";
}

function toggleCreateGroupForm(show) {
  const listPanel = document.querySelector(".group-list-panel");
  const createPanel = document.querySelector(".group-create-panel");
  if (show) {
    listPanel.classList.add("hidden");
    createPanel.classList.remove("hidden");
  } else {
    createPanel.classList.add("hidden");
    listPanel.classList.remove("hidden");
  }
}

function updateAuthUI() {
  $("authStatusLabel").textContent = authState.mode === "user"
    ? ui(`${authState.user?.name || "使用者"} · 已登入`, `${authState.user?.name || "User"} · Signed in`)
    : ui("訪客模式", "Guest mode");
  $("authActionBtn").textContent = authState.mode === "user" ? ui("登出", "Sign out") : ui("登入 / 註冊", "Sign in / Register");
  renderSettingsUserInfo();
}

function openAuthModal(loginMode) {
  isLoginMode = loginMode;
  $("authModal").classList.remove("hidden");
  $("authModalTitle").textContent = loginMode ? ui("登入", "Sign in") : ui("建立帳號", "Create account");
  $("authSubmitBtn").textContent = loginMode ? ui("登入", "Sign in") : ui("建立帳號", "Create account");
  $("authToggleBtn").textContent = loginMode ? ui("建立帳號", "Create account") : ui("改用登入", "Use sign in");
  $("authNameGroup").style.display = loginMode ? "none" : "block";
  $("authPasswordInput").autocomplete = loginMode ? "current-password" : "new-password";
}

async function handleAuthSubmit() {
  const email = $("authEmailInput").value.trim();
  const password = $("authPasswordInput").value;
  const name = $("authNameInput").value.trim();
  if (!email || !password || (!isLoginMode && !name)) return alert(ui("請完整填寫資料。", "Please complete all fields."));
  if (password.length < 8) return alert(ui("密碼至少需要 8 個字元。", "Password must be at least 8 characters."));

  const endpoint = isLoginMode ? "/auth/login" : "/auth/register";
  const payload = isLoginMode ? { email, password } : { email, password, name };
  const guestData = authState.mode === "guest" ? normalizeAppData(appData) : getEmptyData();

  try {
    const res = await apiRequest(endpoint, { method: "POST", body: JSON.stringify(payload) });
    authState = { mode: "user", token: res.token, user: res.user };
    saveAuthState();
    await loadUserDataFromServer();
    appData = mergeAppData(appData, guestData);
    saveData();
    $("authModal").classList.add("hidden");
    updateAuthUI();
    initChatSocket();
    applySettingsToTimer();
    renderAll();
    checkAdminStatus();
    showToast(ui("已登入並同步資料", "Signed in and synced data"));
  } catch (err) {
    alert(ui(`登入或註冊失敗：${err.message}`, `Sign in or registration failed: ${err.message}`));
  }
}

function logout() {
  if (!confirm(ui("確定要登出？登入資料會保留在伺服器，畫面會切回訪客資料。", "Sign out? Synced data will remain on the server and the app will switch back to guest data."))) return;
  authState = { mode: "guest", user: null, token: null };
  saveAuthState();
  resetFriendsState();
  appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
  currentTaskIdForPomodoro = localStorage.getItem(LS_FOCUS_TASK_KEY);
  currentUserIsAdmin = false;
  updateAuthUI();
  applySettingsToTimer();
  renderAll();
}

async function checkAdminStatus() {
  if (authState.mode !== "user") {
    currentUserIsAdmin = false;
    hideAdminNav();
    return;
  }
  try {
    const response = await authenticatedApiRequest("/admin/me");
    if (response.isAdmin) {
      currentUserIsAdmin = true;
      showAdminNav();
    } else {
      currentUserIsAdmin = false;
      hideAdminNav();
    }
  } catch (err) {
    console.error("檢查管理員權限失敗:", err);
    currentUserIsAdmin = false;
    hideAdminNav();
  }
}

function showAdminNav() {
  const adminNav = document.querySelector('.nav-link[data-page="admin"]');
  if (adminNav) adminNav.classList.remove("hidden");
}

function hideAdminNav() {
  const adminNav = document.querySelector('.nav-link[data-page="admin"]');
  if (adminNav) adminNav.classList.add("hidden");
  // 如果目前在 admin 頁面，切回 dashboard
  if (currentPage === "admin") {
    switchPage("dashboard");
  }
}

function renderSettingsUserInfo() {
  const email = $("settingsUserEmail");
  const name = $("settingsUserName");
  const api = $("apiBaseLabel");
  if (email) email.textContent = authState.user?.email || "-";
  if (name) name.textContent = authState.user?.name || "-";
  if (api) api.textContent = API_BASE;
}

async function handleChangeName() {
  if (authState.mode !== "user") return alert(ui("請先登入。", "Please sign in first."));
  const name = prompt(ui("請輸入新的名稱", "Enter a new name"), authState.user?.name || "");
  if (!name) return;
  try {
    const res = await apiRequest("/auth/update-name", {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ name })
    });
    authState.user = res.user;
    saveAuthState();
    updateAuthUI();
    showToast(ui("名稱已更新", "Name updated"));
  } catch (err) {
    alert(ui(`更新失敗：${err.message}`, `Update failed: ${err.message}`));
  }
}

async function handleChangePassword() {
  if (authState.mode !== "user") return alert(ui("請先登入。", "Please sign in first."));
  const password = $("newPasswordInput").value.trim();
  if (password.length < 8) return alert(ui("新密碼至少需要 8 個字元。", "New password must be at least 8 characters."));
  try {
    await apiRequest("/auth/update-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ password })
    });
    $("newPasswordInput").value = "";
    showToast(ui("密碼已更新", "Password updated"));
  } catch (err) {
    alert(ui(`更新失敗：${err.message}`, `Update failed: ${err.message}`));
  }
}

async function handleDeleteAccount() {
  if (authState.mode !== "user") return alert(ui("請先登入。", "Please sign in first."));
  if (!confirm(ui("確定要刪除帳號？伺服器上的帳號與資料會移除。", "Delete this account? The server account and data will be removed."))) return;
  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    localStorage.removeItem(LS_AUTH_KEY);
    localStorage.removeItem(LS_USER_CACHE_KEY);
    authState = { mode: "guest", user: null, token: null };
    resetFriendsState();
    appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
    updateAuthUI();
    renderAll();
    showToast(ui("帳號已刪除，已切回訪客模式", "Account deleted. Switched back to guest mode."));
  } catch (err) {
    alert(ui(`刪除失敗：${err.message}`, `Delete failed: ${err.message}`));
  }
}

function ensureCurrentFocusTaskExists() {
  if (currentTaskIdForPomodoro && !appData.tasks.some((task) => task.id === currentTaskIdForPomodoro)) {
    currentTaskIdForPomodoro = null;
  }
}

function renderCurrentPage() {
  if (currentPage === "dashboard") {
    renderMetrics();
    renderFocusCards();
    renderHeatmap("learningHeatmapDashboard");
    renderCharts();
    loadReflection();
    return;
  }

  if (currentPage === "focus") {
    renderFocusPage();
    return;
  }

  if (currentPage === "tasks") {
    renderTaskList();
    return;
  }

  if (currentPage === "learning") {
    renderLearning();
    renderHeatmap("learningHeatmapLearning");
    renderCharts();
    return;
  }

  if (currentPage === "friends") {
    renderFriends();
    return;
  }

  if (currentPage === "groups") {
    renderGroups();
    return;
  }

  if (currentPage === "threads") {
    renderThreads();
    return;
  }

  if (currentPage === "ai") {
    if (lastAIResult) renderAIResult(lastAIResult);
    renderAILogs();
    return;
  }

  if (currentPage === "admin") {
    renderAdmin();
    return;
  }

  if (currentPage === "settings") {
    renderSettingsUserInfo();
  }
}

function renderAll() {
  ensureCurrentFocusTaskExists();
  renderCurrentPage();
}

function bindEvents() {
  document.querySelectorAll(".nav-link").forEach((button) => {
    button.onclick = () => setPage(button.dataset.page);
  });
  $("headerSettingsBtn").onclick = () => setPage("settings");

  $("taskForm").onsubmit = handleTaskSubmit;
  $("clearFormBtn").onclick = clearTaskForm;
  $("taskFilter").onchange = renderTaskList;
  $("selectTopTaskBtn").onclick = () => pickTopTask(true);
  $("smartSortBtn").onclick = smartSortTasks;
  $("saveReflectionBtn").onclick = saveReflection;

  $("startTimerBtn").onclick = startTimer;
  $("pauseTimerBtn").onclick = pauseTimer;
  $("resetTimerBtn").onclick = resetTimer;
  $("endFocusBtn").onclick = () => endFocusSession(false);
  $("focusFeedbackPanel").onsubmit = saveFocusFeedback;
  $("distractionInput").onkeydown = recordDistraction;
  $("saveSettingsBtn").onclick = savePomodoroSettings;
  $("languageSelect").onchange = handleLanguageChange;

  $("learningForm").onsubmit = addSubject;
  $("exportJsonBtn").onclick = exportJson;
  $("importJsonInput").onchange = (event) => importJson(event.target.files?.[0]);
  $("friendInviteForm").onsubmit = (event) => {
    event.preventDefault();
    sendFriendRequest();
  };
  $("chatForm").onsubmit = (event) => {
    event.preventDefault();
    sendChatMessage();
  };
  document.querySelectorAll(".quick-message").forEach((button) => {
    button.onclick = () => sendQuickMessage(button.dataset.message || button.textContent);
  });
  $("chatInput").oninput = () => {
    if (!activeChatFriendId || !chatSocket?.connected) return;
    chatSocket.emit("typing:start", { friendId: activeChatFriendId });
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      chatSocket?.emit("typing:stop", { friendId: activeChatFriendId });
    }, 900);
  };
  $("openImagePickerBtn").onclick = () => $("chatImageInput").click();
  $("chatImageInput").onchange = (event) => {
    handleImageUpload(event.target.files?.[0]);
    event.target.value = "";
  };
  $("shareTaskBtn").onclick = () => {
    if (isShowingGroups || !friendsState.selectedFriendId) return;
    shareTaskWithFriend(friendsState.selectedFriendId, $("shareTaskSelect")?.value || "");
  };
  $("createFocusRoomBtn").onclick = () => {
    if (isShowingGroups || !friendsState.selectedFriendId) return;
    createFocusRoom(friendsState.selectedFriendId);
  };
  $("friendMetaForm").onsubmit = (event) => {
    event.preventDefault();
    updateFriendMeta();
  };

  // 群組相關事件
  $("createGroupBtn").onclick = () => toggleCreateGroupForm(true);
  $("cancelCreateGroupBtn").onclick = () => toggleCreateGroupForm(false);
  $("createGroupForm").onsubmit = (event) => {
    event.preventDefault();
    createGroup();
  };
  $("groupChatForm").onsubmit = (event) => {
    event.preventDefault();
    sendGroupChatMessage();
  };
  $("groupOpenImagePickerBtn").onclick = () => $("groupChatImageInput").click();
  $("groupChatImageInput").onchange = (event) => {
    handleGroupImageUpload(event.target.files?.[0]);
    event.target.value = "";
  };
  $("inviteFriendBtn").onclick = () => {
    const friendId = $("inviteFriendSelect").value;
    if (friendId && groupsState.selectedGroupId) {
      inviteFriendToGroup(groupsState.selectedGroupId, friendId);
    }
  };
  $("groupSettingsForm").onsubmit = (event) => {
    event.preventDefault();
    updateGroup(groupsState.selectedGroupId);
  };
  $("leaveGroupBtn").onclick = () => leaveGroup(groupsState.selectedGroupId);

  // Threads 相關事件
  $("threadForm").onsubmit = (event) => {
    event.preventDefault();
    createThread();
  };
  $("threadSearch").oninput = () => {
    threadsState.filters.search = $("threadSearch").value;
    renderThreadList();
  };
  $("threadSubjectFilter").onchange = () => {
    threadsState.filters.subject = $("threadSubjectFilter").value;
    renderThreadList();
  };
  $("threadStatusFilter").onchange = () => {
    threadsState.filters.status = $("threadStatusFilter").value;
    renderThreadList();
  };
  $("threadTagFilter").onchange = () => {
    threadsState.filters.tag = $("threadTagFilter").value;
    renderThreadList();
  };
  $("closeThreadBtn").onclick = () => closeThread(threadsState.currentThreadId);
  $("replyForm").onsubmit = (event) => {
    event.preventDefault();
    createThreadReply(threadsState.currentThreadId);
  };

  document.querySelectorAll(".ai-action").forEach((button) => {
    button.onclick = () => handleAIAction(button.dataset.aiAction);
  });

  $("authActionBtn").onclick = () => authState.mode === "user" ? logout() : openAuthModal(true);
  $("authCancelBtn").onclick = () => $("authModal").classList.add("hidden");
  $("authToggleBtn").onclick = () => openAuthModal(!isLoginMode);
  $("authSubmitBtn").onclick = handleAuthSubmit;

  $("changeNameBtn").onclick = handleChangeName;
  $("changePasswordBtn").onclick = handleChangePassword;
  $("deleteAccountBtn").onclick = handleDeleteAccount;

  document.addEventListener("keydown", handleKeyboardShortcuts);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      showOnlineFriendsOverlay();
    }
  });
  document.addEventListener("keyup", (event) => {
    if (event.key === "Tab") {
      hideOnlineFriendsOverlay();
    }
  });
}

async function init() {
  bindEvents();
  loadAuthState();

  try {
    if (authState.mode === "user" && authState.token) {
      await loadUserDataFromServer();
    } else {
      appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
      setSyncStatus("guestLocal");
    }
  } catch (_) {
    appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_USER_CACHE_KEY) || "{}"));
    setSyncStatus("offlineCache");
  }

  currentTaskIdForPomodoro = localStorage.getItem(LS_FOCUS_TASK_KEY)
    || appData.tasks.find((task) => task.status === "doing")?.id
    || null;
  updateAuthUI();
  await checkAdminStatus();
  applyLanguage();
  initChatSocket();
  applySettingsToTimer();
  setPage("dashboard");
}

// Threads 相關函數
async function renderThreads() {
  await fetchThreads();
  renderThreadList();
  if (threadsState.currentThreadId) {
    await fetchThreadDetail(threadsState.currentThreadId);
    renderThreadDetail();
  }
}

async function fetchThreads() {
  try {
    const response = await authenticatedApiRequest("/threads");
    threadsState.threads = response.threads || [];
    updateThreadFilters();
  } catch (error) {
    console.error("Failed to fetch threads:", error);
    showToast(ui("載入討論串失敗", "Failed to load threads"));
  }
}

async function createThread() {
  const formData = new FormData();
  formData.append("title", $("threadTitle").value.trim());
  formData.append("content", $("threadContent").value.trim());
  formData.append("subject", $("threadSubject").value.trim());
  const tags = $("threadTags").value.split(',').map(t => t.trim()).filter(t => t);
  formData.append("tags", JSON.stringify(tags));

  const images = $("threadImages").files;
  for (let i = 0; i < images.length; i++) {
    formData.append("images", images[i]);
  }

  if (!formData.get("title") || !formData.get("content")) {
    showToast(ui("請填寫標題和內容", "Please fill in title and content"));
    return;
  }

  try {
    const response = await authenticatedApiRequest("/threads/create", {
      method: "POST",
      body: formData
    });
    showToast(ui("討論串發問成功", "Thread created successfully"));
    clearThreadForm();
    await fetchThreads();
    renderThreadList();
  } catch (error) {
    console.error("Failed to create thread:", error);
    showToast(ui("發問失敗", "Failed to create thread"));
  }
}

async function openThread(threadId) {
  threadsState.currentThreadId = threadId;
  await fetchThreadDetail(threadId);
  renderThreadDetail();
}

async function fetchThreadDetail(threadId) {
  try {
    const response = await authenticatedApiRequest(`/threads/${threadId}`);
    threadsState.currentThread = response.thread;
  } catch (error) {
    console.error("Failed to fetch thread detail:", error);
    showToast(ui("載入討論串詳細內容失敗", "Failed to load thread details"));
  }
}

async function createThreadReply(threadId) {
  const formData = new FormData();
  formData.append("content", $("replyContent").value.trim());

  const images = $("replyImages").files;
  for (let i = 0; i < images.length; i++) {
    formData.append("images", images[i]);
  }

  if (!formData.get("content")) {
    showToast(ui("請填寫回覆內容", "Please fill in reply content"));
    return;
  }

  try {
    const response = await authenticatedApiRequest(`/threads/${threadId}/reply`, {
      method: "POST",
      body: formData
    });
    showToast(ui("回覆成功", "Reply posted successfully"));
    clearReplyForm();
    await fetchThreadDetail(threadId);
    renderThreadDetail();
  } catch (error) {
    console.error("Failed to create reply:", error);
    showToast(ui("回覆失敗", "Failed to post reply"));
  }
}

async function acceptThreadReply(threadId, replyId) {
  try {
    await authenticatedApiRequest(`/threads/${threadId}/accept-reply`, {
      method: "POST",
      body: JSON.stringify({ replyId })
    });
    showToast(ui("已標記最佳解答", "Marked as accepted answer"));
    await fetchThreadDetail(threadId);
    renderThreadDetail();
  } catch (error) {
    console.error("Failed to accept reply:", error);
    showToast(ui("標記最佳解答失敗", "Failed to mark as accepted"));
  }
}

async function closeThread(threadId) {
  try {
    await authenticatedApiRequest(`/threads/${threadId}/close`, {
      method: "POST"
    });
    showToast(ui("討論串已結案", "Thread closed"));
    await fetchThreads();
    renderThreadList();
    await fetchThreadDetail(threadId);
    renderThreadDetail();
  } catch (error) {
    console.error("Failed to close thread:", error);
    showToast(ui("結案失敗", "Failed to close thread"));
  }
}

function renderThreadList() {
  const list = $("threadList");
  const filteredThreads = threadsState.threads.filter(thread => {
    const matchesSearch = !threadsState.filters.search ||
      thread.title.toLowerCase().includes(threadsState.filters.search.toLowerCase()) ||
      thread.content.toLowerCase().includes(threadsState.filters.search.toLowerCase());
    const matchesSubject = !threadsState.filters.subject || thread.subject === threadsState.filters.subject;
    const matchesStatus = !threadsState.filters.status || thread.status === threadsState.filters.status;
    const matchesTag = !threadsState.filters.tag ||
      thread.tags.some(tag => tag === threadsState.filters.tag);
    return matchesSearch && matchesSubject && matchesStatus && matchesTag;
  });

  list.innerHTML = filteredThreads.map(thread => `
    <li class="thread-card ${threadsState.currentThreadId === thread.id ? 'active' : ''}" onclick="openThread('${thread.id}')">
      <div class="thread-header">
        <h4>${escapeHtml(thread.title)}</h4>
        <span class="thread-status status-${thread.status}">${thread.status === 'open' ? ui('開放中', 'Open') : ui('已結案', 'Closed')}</span>
      </div>
      <div class="thread-meta">
        <span class="thread-subject">${escapeHtml(thread.subject || ui('未分類', 'Uncategorized'))}</span>
        <span class="thread-author">${escapeHtml(thread.author?.name || ui('匿名', 'Anonymous'))}</span>
        <span class="thread-replies">${thread.replies?.length || 0} ${ui('回覆', 'replies')}</span>
        <span class="thread-date">${new Date(thread.createdAt).toLocaleDateString()}</span>
      </div>
      <div class="thread-tags">
        ${thread.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
      </div>
    </li>
  `).join('');
}

function renderThreadDetail() {
  const detail = $("threadDetail");
  const replies = $("threadReplies");
  const actions = $("threadActions");
  const title = $("threadDetailTitle");

  if (!threadsState.currentThread) {
    detail.innerHTML = `<p>${ui('請從左側選擇討論串查看詳細內容。', 'Please select a thread from the left to view details.')}</p>`;
    replies.classList.add('hidden');
    actions.classList.add('hidden');
    title.textContent = ui('請選擇討論串', 'Choose a Thread');
    return;
  }

  const thread = threadsState.currentThread;
  title.textContent = escapeHtml(thread.title);
  actions.classList.remove('hidden');
  if ($("closeThreadBtn")) {
    $("closeThreadBtn").style.display = thread.status === 'open' && thread.author?.id === authState.user?.id ? 'inline-block' : 'none';
  }

  const threadImages = Array.isArray(thread.imageUrls) ? thread.imageUrls : [];
  detail.innerHTML = `
    <div class="thread-content">
      <div class="thread-info">
        <span class="thread-author">${escapeHtml(thread.author?.name || ui('匿名', 'Anonymous'))}</span>
        <span class="thread-date">${new Date(thread.createdAt).toLocaleDateString()}</span>
        <span class="thread-status status-${thread.status}">${thread.status === 'open' ? ui('開放中', 'Open') : ui('已結案', 'Closed')}</span>
      </div>
      <div class="thread-subject-tags">
        <span class="thread-subject">${escapeHtml(thread.subject || ui('未分類', 'Uncategorized'))}</span>
        <div class="thread-tags">
          ${thread.tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      <div class="thread-text">${escapeHtml(thread.content).replace(/\n/g, '<br>')}</div>
      ${threadImages.length ? `
        <div class="thread-image-grid">
          ${threadImages.map((imageUrl) => {
            const resolved = resolveAssetUrl(imageUrl);
            return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener"><img src="${escapeHtml(resolved)}" alt="${ui('討論串圖片', 'Thread image')}" /></a>`;
          }).join('')}
        </div>
      ` : ''}
    </div>
  `;

  replies.classList.remove('hidden');
  const replyList = $("replyList");
  replyList.innerHTML = thread.replies.map((reply) => {
    const replyImages = Array.isArray(reply.imageUrls) ? reply.imageUrls : [];
    const isAccepted = reply.id === thread.acceptedReplyId;
    return `
      <li class="reply-card ${isAccepted ? 'accepted-reply' : ''}">
        <div class="reply-header">
          <span class="reply-author">${escapeHtml(reply.author?.name || ui('匿名', 'Anonymous'))}</span>
          <span class="reply-date">${new Date(reply.createdAt).toLocaleDateString()}</span>
          ${isAccepted ? `<span class="accepted-badge">${ui('最佳解答', 'Accepted Answer')}</span>` : ''}
          ${thread.author?.id === authState.user?.id && thread.status === 'open' && !isAccepted ? `
            <button class="accept-reply-btn small" onclick="acceptThreadReply('${thread.id}', '${reply.id}')">${ui('標記為最佳解答', 'Mark as Accepted')}</button>
          ` : ''}
        </div>
        <div class="reply-content">${escapeHtml(reply.content).replace(/\n/g, '<br>')}</div>
        ${replyImages.length ? `
          <div class="reply-image-grid">
            ${replyImages.map((imageUrl) => {
              const resolved = resolveAssetUrl(imageUrl);
              return `<a href="${escapeHtml(resolved)}" target="_blank" rel="noopener"><img src="${escapeHtml(resolved)}" alt="${ui('回覆圖片', 'Reply image')}" /></a>`;
            }).join('')}
          </div>
        ` : ''}
      </li>
    `;
  }).join('');
}

function updateThreadFilters() {
  const subjectFilter = $("threadSubjectFilter");
  const tagFilter = $("threadTagFilter");

  if (!subjectFilter || !tagFilter) return;

  const subjects = [...new Set(threadsState.threads.map(t => t.subject).filter(Boolean))];
  subjectFilter.innerHTML = `<option value="">${ui('所有科目', 'All Subjects')}</option>` +
    subjects.map(subject => `<option value="${escapeHtml(subject)}">${escapeHtml(subject)}</option>`).join('');

  const allTags = threadsState.threads.flatMap(t => t.tags || []);
  const tags = [...new Set(allTags)];
  tagFilter.innerHTML = `<option value="">${ui('所有標籤', 'All Tags')}</option>` +
    tags.map(tag => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`).join('');
}

function clearThreadForm() {
  $("threadTitle").value = '';
  $("threadContent").value = '';
  $("threadSubject").value = '';
  $("threadTags").value = '';
  if ($("threadImages")) $("threadImages").value = '';
}

function clearReplyForm() {
  $("replyContent").value = '';
  if ($("replyImages")) $("replyImages").value = '';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

window.addEventListener("load", init);
