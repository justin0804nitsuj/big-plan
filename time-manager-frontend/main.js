const LS_GUEST_KEY = "timeManager_guest_v2";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v2";
const LS_AUTH_KEY = "timeManager_auth_v2";
const LS_FOCUS_TASK_KEY = "timeManager_current_focus_task_v2";

const DEFAULT_API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:3000"
  : "https://big-plan.onrender.com";
const API_BASE = localStorage.getItem("timeManager_api_base") || DEFAULT_API_BASE;

const PAGE_DEFAULTS = {
  dashboard: {
    title: "今日總覽",
    eyebrow: "Dashboard",
    subtitle: "用數據、任務與專注儀表板，把今天的注意力放到最值得處理的地方。"
  },
  focus: {
    title: "Deep Focus Mode",
    eyebrow: "Focus",
    subtitle: "只保留焦點任務、計時器、專注控制與分心紀錄，讓畫面幫你降噪。"
  },
  tasks: {
    title: "任務系統",
    eyebrow: "Tasks",
    subtitle: "用優先級、能量、任務類型與智慧分數決定下一步，而不是只靠感覺。"
  },
  learning: {
    title: "學習計畫",
    eyebrow: "Learning",
    subtitle: "把科目進度、複習間隔與學習熱度集中管理，讓記憶曲線變得可操作。"
  },
  ai: {
    title: "AI Assistant",
    eyebrow: "AI",
    subtitle: "先以 mock 回應建立前端資料流程，未來可把 requestAI 改接後端或 OpenAI API。"
  },
  settings: {
    title: "設定與資料",
    eyebrow: "Settings",
    subtitle: "管理帳號、Focus 時長與 JSON 匯入匯出；Guest 與登入同步都保留。"
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
      breakMinutes: 5
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
    result: log.result && typeof log.result === "object" ? log.result : { title: "AI 回應", summary: String(log.result || "") }
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
      breakMinutes: Math.max(1, Number(value.settings?.breakMinutes) || empty.settings.breakMinutes)
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
  return { low: "低", medium: "中", high: "高" }[priority] || "中";
}

function statusText(status) {
  return { todo: "待辦", doing: "進行中", done: "已完成", deferred: "延後" }[status] || "待辦";
}

function categoryText(category) {
  return {
    school: "學校",
    research: "研究",
    work: "工作",
    project: "專案",
    personal: "個人",
    study: "學習"
  }[category] || "未分類";
}

function energyText(energy) {
  return { low: "低能量", medium: "中能量", high: "高能量" }[energy] || "中能量";
}

function taskTypeText(type) {
  return type === "shallow" ? "Shallow" : "Deep";
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
  if (label) label.textContent = message;
}

async function apiRequest(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
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
    setSyncStatus("Guest local");
  }
}

function scheduleSaveDataToServer() {
  if (!authState.token) return;
  setSyncStatus("Syncing...");
  if (saveDataDebounceTimer) clearTimeout(saveDataDebounceTimer);
  saveDataDebounceTimer = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify(appData)
      });
      setSyncStatus("Synced");
    } catch (err) {
      setSyncStatus("Sync failed");
      showToast(`同步失敗：${err.message}`);
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
  setSyncStatus("Synced");
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
  currentPage = PAGE_DEFAULTS[page] ? page : "dashboard";
  document.querySelectorAll(".page").forEach((section) => {
    section.classList.toggle("active", section.id === `page-${currentPage}`);
  });
  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.page === currentPage);
  });

  const activePage = $(`page-${currentPage}`);
  const fallback = PAGE_DEFAULTS[currentPage];
  $("pageTitle").textContent = activePage?.dataset.pageTitle || fallback.title;
  $("pageEyebrow").textContent = activePage?.dataset.pageEyebrow || fallback.eyebrow;
  $("pageSubtitle").textContent = activePage?.dataset.pageSubtitle || fallback.subtitle;
  renderAll();
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
    list.innerHTML = `<li class="empty-state">目前沒有符合條件的任務。</li>`;
    initSortable();
    return;
  }

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
        <span class="status-pill">Score ${task.score}</span>
      </div>
      <p class="task-description">${escapeHtml(task.description || "沒有描述")}</p>
      <div class="task-meta">
        <span>${task.dueDate || "無期限"}</span>
        <span>${statusText(task.status)}</span>
        <span>${categoryText(task.category)}</span>
        <span>${task.actualMinutes} / ${task.estimateMinutes} 分</span>
        <span>${subDone} / ${task.subtasks.length} 子任務</span>
      </div>
      <div class="tag-row">
        <span class="badge ${task.priority}">${priorityText(task.priority)}優先</span>
        <span class="badge ${task.energyRequired}">${energyText(task.energyRequired)}</span>
        <span class="badge ${task.taskType}">${taskTypeText(task.taskType)}</span>
        ${isOverdue(task) ? `<span class="badge high">已逾期</span>` : ""}
        ${tagHtml}
      </div>
      <div class="subtask-container"></div>
      <input class="subtask-input" placeholder="+ 新增子任務，按 Enter" />
      <div class="task-actions">
        <button class="small edit-btn secondary" type="button">編輯</button>
        <button class="small focus-btn" type="button">設為焦點</button>
        <button class="small done-btn secondary" type="button">${task.status === "done" ? "重開" : "完成"}</button>
        <button class="small danger delete-btn" type="button">刪除</button>
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

    list.appendChild(li);
  });

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
  showToast(`已設定焦點任務：${task.title}`);
}

function deleteTask(taskId) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task || !confirm(`確定要刪除「${task.title}」？`)) return;
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
    showToast("任務已更新");
  } else {
    appData.tasks.push(normalizeTask({ ...payload, id: createId("t"), createdAt: new Date().toISOString() }));
    showToast("任務已新增");
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
    showToast("目前沒有可安排的任務");
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
  showToast("已依任務分數由高到低排序");
}

function buildFocusTaskHtml(task) {
  if (!task) return `<p>尚未指定焦點任務。</p>`;
  return `
    <div class="tag-row">
      <span class="status-pill">${statusText(task.status)}</span>
      <span class="badge ${task.priority}">${priorityText(task.priority)}優先</span>
      <span class="badge ${task.taskType}">${taskTypeText(task.taskType)}</span>
      ${isOverdue(task) ? `<span class="status-pill danger-soft">已逾期</span>` : ""}
    </div>
    <h4>${escapeHtml(task.title)}</h4>
    <p>${escapeHtml(task.description || "沒有描述")}</p>
    <div class="task-meta">
      <span>${task.dueDate || "無期限"}</span>
      <span>${categoryText(task.category)}</span>
      <span>${task.actualMinutes} / ${task.estimateMinutes} 分</span>
      <span>Score ${calculateTaskScore(task)}</span>
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
  if (label) label.textContent = task ? `現在專注：${task.title}` : "尚未選擇焦點任務";
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  const timerValue = $("timerValue");
  const modeLabel = $("timerModeLabel");
  if (timerValue) timerValue.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (modeLabel) modeLabel.textContent = timerState.running ? "Focusing" : "Focus";
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
    showToast("請先選擇焦點任務");
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
    showToast("沒有焦點任務可結束");
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
  if (meta) meta.textContent = `${durationMinutes} 分鐘 · 分心 ${sessionDistractions.length} 次`;
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
  showToast("專注紀錄已儲存");
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
    showToast("請先開始專注，再記錄分心");
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
  countLabel.textContent = `本次分心 ${count} 次`;
}

function savePomodoroSettings() {
  const focus = Number($("focusMinutesInput").value);
  const breakMinutes = Number($("breakMinutesInput").value);
  if (focus < 1 || breakMinutes < 1) return alert("時間設定必須大於 0");
  appData.settings.focusMinutes = Math.round(focus);
  appData.settings.breakMinutes = Math.round(breakMinutes);
  saveData();
  applySettingsToTimer();
  showToast("專注設定已儲存");
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
  $("metricFocusMinutes").textContent = `${focusMinutes} 分`;
  const weekDone = appData.tasks.filter((task) => task.completedAt && getWeekDates().includes(task.completedAt.slice(0, 10))).length;
  $("metricWeekDone").textContent = `${weekDone} 件`;
  $("metricQuality").textContent = quality ? `${quality} / 5` : "-";
  $("metricDistractions").textContent = `${distractions} 次`;
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
  if (chartInstances[canvasId]) chartInstances[canvasId].destroy();
  chartInstances[canvasId] = new Chart(canvas.getContext("2d"), config);
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
        datasets: [{ label: "專注分鐘", data: dates.map(getFocusMinutesOnDate), borderColor: "#63e6be", backgroundColor: "rgba(99,230,190,.18)", tension: .35, fill: true }]
      },
      options: chartBaseOptions()
    });

    createChart("completedTasksChart", {
      type: "bar",
      data: {
        labels,
        datasets: [{ label: "完成任務", data: dates.map(getCompletedTasksOnDate), backgroundColor: "#74c0fc" }]
      },
      options: chartBaseOptions()
    });

    const categoryData = getCategoryTimeData();
    createChart("categoryTimeChart", {
      type: "pie",
      data: {
        labels: categoryData.length ? categoryData.map(([label]) => label) : ["尚無資料"],
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
        labels: estimateTasks.length ? estimateTasks.map((task) => task.title.slice(0, 12)) : ["尚無資料"],
        datasets: [
          { label: "預估", data: estimateTasks.length ? estimateTasks.map((task) => task.estimateMinutes) : [0], backgroundColor: "#ffd166" },
          { label: "實際", data: estimateTasks.length ? estimateTasks.map((task) => task.actualMinutes) : [0], backgroundColor: "#63e6be" }
        ]
      },
      options: chartBaseOptions()
    });

    createChart("distractionChart", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: "分心次數", data: dates.map(getDistractionsOnDate), borderColor: "#ff8787", backgroundColor: "rgba(255,135,135,.16)", tension: .35, fill: true }]
      },
      options: chartBaseOptions()
    });

    createChart("qualityChart", {
      type: "line",
      data: {
        labels,
        datasets: [{ label: "平均分數", data: dates.map(getAverageFocusScoreOnDate), borderColor: "#b197fc", backgroundColor: "rgba(177,151,252,.14)", tension: .35, fill: true }]
      },
      options: { ...chartBaseOptions(), scales: { ...chartBaseOptions().scales, y: { ...chartBaseOptions().scales.y, suggestedMax: 5 } } }
    });

    const learningData = getLearningProgressData();
    createChart("learningProgressChart", {
      type: "bar",
      data: {
        labels: learningData.length ? learningData.map((item) => item.label) : ["尚無資料"],
        datasets: [{ label: "進度 %", data: learningData.length ? learningData.map((item) => item.value) : [0], backgroundColor: "#20c997" }]
      },
      options: chartBaseOptions()
    });
  }

  if (currentPage === "learning") {
    const learningData = getLearningProgressData();
    createChart("learningSubjectChart", {
      type: "bar",
      data: {
        labels: learningData.length ? learningData.map((item) => item.label) : ["尚無資料"],
        datasets: [{ label: "進度 %", data: learningData.length ? learningData.map((item) => item.value) : [0], backgroundColor: "#63e6be" }]
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
    return `<span class="heat-cell heat-${level}" title="${date} · ${value} 分"></span>`;
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
    list.innerHTML = `<li class="empty-state">新增第一個學習科目後，這裡會顯示進度與複習排程。</li>`;
    return;
  }

  list.innerHTML = "";
  subjects.forEach((subject) => {
    const item = document.createElement("li");
    const subjectPercent = subject.targetMinutes > 0 ? Math.min(100, Math.round((subject.studiedMinutes / subject.targetMinutes) * 100)) : 0;
    const reviewDue = subject.nextReviewDate && subject.nextReviewDate <= todayKey();
    item.className = `learning-item ${reviewDue ? "review-due" : ""}`;
    item.innerHTML = `
      <div class="learning-head">
        <strong>${escapeHtml(subject.name)}</strong>
        <span>${subject.studiedMinutes} / ${subject.targetMinutes} 分</span>
      </div>
      <div class="progress-track small-track"><div class="progress-bar" style="width:${subjectPercent}%"></div></div>
      <p class="note">${escapeHtml(subject.currentUnit || "尚未設定目前單元")}</p>
      <div class="learning-meta">
        <span>${reviewDue ? "今天需要複習" : `下次複習：${subject.nextReviewDate || "未設定"}`}</span>
        <span>interval ${subject.interval}</span>
        <span>ease ${subject.easeFactor.toFixed(1)}</span>
        <span>複習 ${subject.reviewHistory.length} 次</span>
      </div>
      <p class="note">${escapeHtml(subject.note || "")}</p>
      <div class="learning-actions">
        <button class="small add25" type="button">+25 分</button>
        <button class="small secondary add5" type="button">+5 分</button>
        <button class="small secondary review" type="button">完成複習</button>
        <button class="small danger remove" type="button">刪除</button>
      </div>
    `;
    item.querySelector(".add25").onclick = () => addStudyMinutes(subject.id, 25);
    item.querySelector(".add5").onclick = () => addStudyMinutes(subject.id, 5);
    item.querySelector(".review").onclick = () => completeReview(subject.id);
    item.querySelector(".remove").onclick = () => removeSubject(subject.id);
    list.appendChild(item);
  });
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
  showToast("學習科目已新增");
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
  showToast(`已排到 ${subject.nextReviewDate} 複習`);
}

function removeSubject(subjectId) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject || !confirm(`確定要刪除「${subject.name}」？`)) return;
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
  showToast("今日回顧已儲存");
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
      showToast("JSON 已匯入並完成資料正規化");
    } catch (_) {
      alert("JSON 格式無法解析，請確認檔案內容。");
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
        body: JSON.stringify(payload)
      });
      return { ...result, source: "backend-mock" };
    } catch (err) {
      const local = mockAIResponse(action, payload);
      return { ...local, source: "local-mock", notice: `後端 AI mock 暫時不可用，已改用前端 mock：${err.message}` };
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
      const block = index === 0 ? "第一個深度專注區塊" : `第 ${index + 1} 個處理區塊`;
      return `${block}：${task.title}（${task.estimateMinutes || 25} 分，Score ${task.score}）`;
    });
    return {
      title: "今天的建議安排",
      summary: planItems.length ? "先處理高分任務，再用低能量時段收尾淺層工作。" : "目前沒有待辦任務，可以安排學習或回顧。",
      items: planItems.length ? planItems : ["新增一個今天最重要的任務", "完成 25 分鐘學習", "寫下今日回顧"],
      taskId: tasks[0]?.id || null
    };
  }

  if (action === "suggest-task") {
    return {
      title: "下一個任務建議",
      summary: current ? `建議先做「${current.title}」，它目前的智慧分數最高。` : "目前沒有可建議的任務。",
      items: current ? [
        `Score：${calculateTaskScore(current)}`,
        `類型：${taskTypeText(current.taskType)}，能量：${energyText(current.energyRequired)}`,
        `預估：${current.estimateMinutes || 25} 分`
      ] : ["建立一個明確、可完成的下一步"],
      taskId: current?.id || null
    };
  }

  if (action === "breakdown-task") {
    const title = current?.title || "目前任務";
    return {
      title: `拆解：${title}`,
      summary: "先把任務拆成可以在 10 到 25 分鐘內完成的小步驟。",
      items: [
        "定義完成標準",
        "列出需要的資料或工具",
        "完成最小可交付版本",
        "檢查與修正",
        "記錄下一步"
      ],
      subtasks: [
        "定義完成標準",
        "收集必要資料",
        "完成第一版",
        "檢查與修正"
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
    title: "效率分析",
    summary: "這是依據最近 7 天資料產生的 mock 分析。",
    items: [
      `專注總分鐘：${focusMinutes}`,
      `完成任務：${completed}`,
      `分心紀錄：${distractions}`,
      `平均專注品質：${avgQuality || "-"}`
    ]
  };
}

function renderAIResult(result) {
  const container = $("aiResult");
  const source = $("aiResultSource");
  if (!container || !result) return;
  source.textContent = result.source === "backend-mock" ? "Backend mock" : "Local mock";
  const items = Array.isArray(result.items) ? result.items : [];
  container.classList.remove("empty-state");
  container.innerHTML = `
    <h4>${escapeHtml(result.title || "AI 回應")}</h4>
    <p>${escapeHtml(result.summary || "")}</p>
    ${result.notice ? `<p class="muted">${escapeHtml(result.notice)}</p>` : ""}
    ${items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    <div class="button-row">
      ${result.taskId ? `<button id="aiSetFocusBtn" class="small" type="button">設為焦點任務</button>` : ""}
      ${result.subtasks?.length && result.taskId ? `<button id="applyAiBreakdownBtn" class="small secondary" type="button">加入子任務</button>` : ""}
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
  showToast("AI 拆解已加入子任務");
}

async function handleAIAction(action) {
  const buttons = Array.from(document.querySelectorAll(".ai-action"));
  buttons.forEach((button) => { button.disabled = true; });
  $("aiResult").textContent = "AI mock 正在整理資料...";
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
  return {
    "plan-day": "安排今天",
    "suggest-task": "挑下一個任務",
    "breakdown-task": "拆解任務",
    analyze: "效率分析"
  }[action] || action;
}

function renderAILogs() {
  const list = $("aiLogsList");
  if (!list) return;
  if (!appData.aiLogs.length) {
    list.innerHTML = `<li class="empty-state">尚無 AI logs。</li>`;
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

function updateAuthUI() {
  $("authStatusLabel").textContent = authState.mode === "user"
    ? `${authState.user?.name || "使用者"} · 已登入`
    : "Guest 模式";
  $("authActionBtn").textContent = authState.mode === "user" ? "登出" : "登入 / 註冊";
  renderSettingsUserInfo();
}

function openAuthModal(loginMode) {
  isLoginMode = loginMode;
  $("authModal").classList.remove("hidden");
  $("authModalTitle").textContent = loginMode ? "登入" : "建立帳號";
  $("authSubmitBtn").textContent = loginMode ? "登入" : "建立帳號";
  $("authToggleBtn").textContent = loginMode ? "建立帳號" : "改用登入";
  $("authNameGroup").style.display = loginMode ? "none" : "block";
  $("authPasswordInput").autocomplete = loginMode ? "current-password" : "new-password";
}

async function handleAuthSubmit() {
  const email = $("authEmailInput").value.trim();
  const password = $("authPasswordInput").value;
  const name = $("authNameInput").value.trim();
  if (!email || !password || (!isLoginMode && !name)) return alert("請完整填寫資料。");
  if (password.length < 8) return alert("密碼至少需要 8 個字元。");

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
    applySettingsToTimer();
    renderAll();
    showToast("已登入並同步資料");
  } catch (err) {
    alert(`登入或註冊失敗：${err.message}`);
  }
}

function logout() {
  if (!confirm("確定要登出？登入資料會保留在伺服器，畫面會切回 Guest 資料。")) return;
  authState = { mode: "guest", user: null, token: null };
  saveAuthState();
  appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
  currentTaskIdForPomodoro = localStorage.getItem(LS_FOCUS_TASK_KEY);
  updateAuthUI();
  applySettingsToTimer();
  renderAll();
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
  if (authState.mode !== "user") return alert("請先登入。");
  const name = prompt("請輸入新的名稱", authState.user?.name || "");
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
    showToast("名稱已更新");
  } catch (err) {
    alert(`更新失敗：${err.message}`);
  }
}

async function handleChangePassword() {
  if (authState.mode !== "user") return alert("請先登入。");
  const password = $("newPasswordInput").value.trim();
  if (password.length < 8) return alert("新密碼至少需要 8 個字元。");
  try {
    await apiRequest("/auth/update-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ password })
    });
    $("newPasswordInput").value = "";
    showToast("密碼已更新");
  } catch (err) {
    alert(`更新失敗：${err.message}`);
  }
}

async function handleDeleteAccount() {
  if (authState.mode !== "user") return alert("請先登入。");
  if (!confirm("確定要刪除帳號？伺服器上的帳號與資料會移除。")) return;
  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    localStorage.removeItem(LS_AUTH_KEY);
    localStorage.removeItem(LS_USER_CACHE_KEY);
    authState = { mode: "guest", user: null, token: null };
    appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
    updateAuthUI();
    renderAll();
    showToast("帳號已刪除，已切回 Guest 模式");
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

function renderAll() {
  appData = normalizeAppData(appData);
  if (currentTaskIdForPomodoro && !appData.tasks.some((task) => task.id === currentTaskIdForPomodoro)) {
    currentTaskIdForPomodoro = null;
  }
  renderMetrics();
  renderFocusPage();
  renderTaskList();
  renderLearning();
  renderLearningHeatmaps();
  renderCharts();
  renderAILogs();
  renderSettingsUserInfo();
  loadReflection();
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

  $("learningForm").onsubmit = addSubject;
  $("exportJsonBtn").onclick = exportJson;
  $("importJsonInput").onchange = (event) => importJson(event.target.files?.[0]);

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
}

async function init() {
  bindEvents();
  loadAuthState();

  try {
    if (authState.mode === "user" && authState.token) {
      await loadUserDataFromServer();
    } else {
      appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
      setSyncStatus("Guest local");
    }
  } catch (_) {
    appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_USER_CACHE_KEY) || "{}"));
    setSyncStatus("Offline cache");
  }

  currentTaskIdForPomodoro = localStorage.getItem(LS_FOCUS_TASK_KEY)
    || appData.tasks.find((task) => task.status === "doing")?.id
    || null;
  updateAuthUI();
  applySettingsToTimer();
  setPage("dashboard");
}

window.addEventListener("load", init);
