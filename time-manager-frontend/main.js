/******************************************************
 *  Time Manager — D Version (Refactored + Toast UI)
 *  功能：
 *  - Guest / User 模式
 *  - 雲端同步（Render 後端）
 *  - 任務 CRUD、分類、排序
 *  - 番茄鐘
 *  - 今日完成度統計
 *  - 匯出 / 匯入 JSON
 *  - Toast 通知系統（取代 alert）
 ******************************************************/

/* ====================================================
 *  1. 常數與狀態
 * ==================================================== */
const API_BASE = "https://big-plan.onrender.com";

const LS_AUTH_KEY = "tm_auth_v1";
const LS_GUEST_KEY = "tm_guest_v1";
const LS_USER_CACHE_KEY = "tm_user_cache_v1";

let authState = {
  mode: "guest",
  user: null,
  token: null,
};

let appData = {
  tasks: [],
  pomodoroHistory: [],
  settings: {
    focusMinutes: 25,
    breakMinutes: 5,
  },
  dailyStats: {},
};

/* Timer 狀態 */
let timerState = {
  mode: "focus",
  remainingSeconds: appData.settings.focusMinutes * 60,
  timerId: null,
  running: false,
};

/* UI 狀態 */
let currentFilter = "all";
let currentTaskIdForPomodoro = null;
let sortableInitialized = false;

/* ====================================================
 *  2. Toast（取代 alert）
 * ==================================================== */
function showToast(msg, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("show");
  }, 10);

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

/* ====================================================
 *  3. Local Storage 存取
 * ==================================================== */
function loadAuthState() {
  try {
    const raw = localStorage.getItem(LS_AUTH_KEY);
    if (raw) authState = JSON.parse(raw);
  } catch {}
}
function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

function loadGuestData() {
  try {
    const raw = localStorage.getItem(LS_GUEST_KEY);
    if (raw) appData = { ...appData, ...JSON.parse(raw) };
  } catch {}
}
function saveGuestData() {
  localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
}

function loadUserCacheData() {
  try {
    const raw = localStorage.getItem(LS_USER_CACHE_KEY);
    if (raw) appData = { ...appData, ...JSON.parse(raw) };
  } catch {}
}
function saveUserCacheData() {
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
}

/* ====================================================
 *  4. API 模組（封裝 fetch）
 * ==================================================== */
async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const headers = options.headers || {};

  const finalOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  const res = await fetch(url, finalOptions);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const json = await res.json();
      if (json.error) msg = json.error;
    } catch {}
    throw new Error(msg);
  }

  return res.status === 204 ? null : res.json();
}

async function loadUserDataFromServer() {
  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: { Authorization: `Bearer ${authState.token}` },
  });
  appData = { ...appData, ...data };
  saveUserCacheData();
}

/* 雲端自動儲存（0.5s debounce） */
let saveServerTimer = null;
function scheduleSaveServer() {
  if (authState.mode !== "user") return;

  if (saveServerTimer) clearTimeout(saveServerTimer);
  saveServerTimer = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify(appData),
      });
    } catch (err) {
      console.warn("Save failed:", err.message);
    }
  }, 500);
}

function saveData() {
  if (authState.mode === "guest") saveGuestData();
  else {
    saveUserCacheData();
    scheduleSaveServer();
  }
}

/* ====================================================
 *  5. 任務模組
 * ==================================================== */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function addTask(task) {
  appData.tasks.push(task);
  saveData();
  renderTaskList();
  showToast("任務新增成功！", "success");
}

function updateTask(id, updates) {
  const idx = appData.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;

  appData.tasks[idx] = { ...appData.tasks[idx], ...updates };
  saveData();
  renderTaskList();
  showToast("任務更新成功！", "success");
}

function deleteTask(id) {
  appData.tasks = appData.tasks.filter((t) => t.id !== id);

  if (currentTaskIdForPomodoro === id) {
    currentTaskIdForPomodoro = null;
    updateCurrentTaskLabel();
  }

  saveData();
  renderTaskList();
  showToast("任務已刪除", "warning");
}

function setTaskDone(id, done) {
  updateTask(id, { status: done ? "done" : "todo" });

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = appData.tasks.filter((t) => t.dueDate === today);

  if (!appData.dailyStats[today]) appData.dailyStats[today] = { done: 0, total: 0 };
  appData.dailyStats[today] = {
    done: todayTasks.filter((t) => t.status === "done").length,
    total: todayTasks.length,
  };

  saveData();
  renderTodayStats();
}

/* ====================================================
 *  6. UI：任務列表
 * ==================================================== */
const taskListEl = document.getElementById("taskList");
const filterButtons = document.querySelectorAll(".filter-btn");

function renderTaskList() {
  taskListEl.innerHTML = "";

  const filtered = appData.tasks.filter((t) => {
    if (currentFilter === "todo") return t.status !== "done";
    if (currentFilter === "done") return t.status === "done";
    return true;
  });

  /* 排序：先未完成、再到期日、再優先度 */
  filtered.sort((a, b) => {
    const o = { todo: 0, done: 1 };
    if (o[a.status] !== o[b.status]) return o[a.status] - o[b.status];

    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate)
      return a.dueDate.localeCompare(b.dueDate);

    const p = { high: 0, medium: 1, low: 2 };
    return p[a.priority] - p[b.priority];
  });

  filtered.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.status}`;
    li.dataset.taskId = task.id;

    const titleRow = document.createElement("div");
    titleRow.className = "task-main";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.status === "done";
    check.addEventListener("change", () => {
      setTaskDone(task.id, check.checked);
    });

    const titleSpan = document.createElement("span");
    titleSpan.textContent = task.title;
    if (task.status === "done") titleSpan.classList.add("done");

    titleRow.appendChild(check);
    titleRow.appendChild(titleSpan);

    /* metadata */
    const meta1 = document.createElement("div");
    meta1.className = "task-meta";
    meta1.textContent = `截止：${task.dueDate || "無"}　優先度：${task.priority}`;

    const meta2 = document.createElement("div");
    meta2.className = "task-meta";
    meta2.textContent = `分類：${task.category || "無"}`;

    /* actions */
    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-small";
    editBtn.textContent = "編輯";
    editBtn.onclick = () => fillFormForEdit(task);

    const bindBtn = document.createElement("button");
    bindBtn.className = "btn-small";
    bindBtn.textContent = "綁定番茄鐘";
    bindBtn.onclick = () => {
      currentTaskIdForPomodoro = task.id;
      updateCurrentTaskLabel();
      showToast("已綁定到番茄鐘", "info");
    };

    const delBtn = document.createElement("button");
    delBtn.className = "btn-small";
    delBtn.style.background = "#e53935";
    delBtn.textContent = "刪除";
    delBtn.onclick = () => {
      deleteTask(task.id);
    };

    actions.append(editBtn, bindBtn, delBtn);

    li.append(titleRow, meta1, meta2, actions);
    taskListEl.appendChild(li);
  });

  renderTodayStats();
  initSortable();
}

/* 表單 */
const taskFormEl = document.getElementById("taskForm");
const taskIdEl = document.getElementById("taskId");
const taskTitleEl = document.getElementById("taskTitle");
const taskDescriptionEl = document.getElementById("taskDescription");
const taskDueDateEl = document.getElementById("taskDueDate");
const taskPriorityEl = document.getElementById("taskPriority");
const taskCategoryEl = document.getElementById("taskCategory");
const clearFormBtn = document.getElementById("clearFormBtn");

taskFormEl.addEventListener("submit", (e) => {
  e.preventDefault();

  const title = taskTitleEl.value.trim();
  if (!title) return showToast("請輸入標題", "warning");

  const data = {
    title,
    description: taskDescriptionEl.value.trim(),
    dueDate: taskDueDateEl.value || "",
    priority: taskPriorityEl.value,
    category: taskCategoryEl.value || "",
  };

  if (taskIdEl.value) {
    updateTask(taskIdEl.value, data);
  } else {
    addTask({ id: createId("t"), status: "todo", ...data });
  }

  clearForm();
});

function fillFormForEdit(task) {
  taskIdEl.value = task.id;
  taskTitleEl.value = task.title;
  taskDescriptionEl.value = task.description || "";
  taskDueDateEl.value = task.dueDate || "";
  taskPriorityEl.value = task.priority || "medium";
  taskCategoryEl.value = task.category || "";
}
function clearForm() {
  taskIdEl.value = "";
  taskTitleEl.value = "";
  taskDescriptionEl.value = "";
  taskDueDateEl.value = "";
  taskPriorityEl.value = "medium";
  taskCategoryEl.value = "";
}

/* 篩選按鈕 */
filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTaskList();
  })
);

/* ====================================================
 *  7. 番茄鐘
 * ==================================================== */
const timerModeLabelEl = document.getElementById("timerModeLabel");
const timerValueEl = document.getElementById("timerValue");
const currentTaskLabelEl = document.getElementById("currentTaskLabel");

function updateCurrentTaskLabel() {
  if (!currentTaskIdForPomodoro)
    return (currentTaskLabelEl.textContent = "尚未選擇任務");

  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  currentTaskLabelEl.textContent = task ? task.title : "找不到任務";
}

function updateTimerDisplay() {
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  timerValueEl.textContent =
    `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  timerModeLabelEl.textContent =
    timerState.mode === "focus" ? "專注時間" : "休息時間";
}

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;

  timerState.timerId = setInterval(() => {
    timerState.remainingSeconds--;
    if (timerState.remainingSeconds <= 0) handleTimerFinished();
    updateTimerDisplay();
  }, 1000);
}

function pauseTimer() {
  timerState.running = false;
  clearInterval(timerState.timerId);
  timerState.timerId = null;
}

function resetTimer() {
  pauseTimer();
  const minutes =
    timerState.mode === "focus"
      ? appData.settings.focusMinutes
      : appData.settings.breakMinutes;

  timerState.remainingSeconds = minutes * 60;
  updateTimerDisplay();
}

function handleTimerFinished() {
  pauseTimer();

  /* 記錄 */
  appData.pomodoroHistory.push({
    id: createId("p"),
    taskId: currentTaskIdForPomodoro,
    mode: timerState.mode,
    duration:
      (timerState.mode === "focus"
        ? appData.settings.focusMinutes
        : appData.settings.breakMinutes) * 60,
    finishedAt: new Date().toISOString(),
  });
  saveData();

  /* 下一階段 */
  if (timerState.mode === "focus") {
    timerState.mode = "break";
    timerState.remainingSeconds = appData.settings.breakMinutes * 60;
    showToast("專注結束，休息一下！", "info");
  } else {
    timerState.mode = "focus";
    timerState.remainingSeconds = appData.settings.focusMinutes * 60;
    showToast("休息結束，回到工作！", "success");
  }

  updateTimerDisplay();
}

/* 番茄鐘 UI */
document.getElementById("startTimerBtn").onclick = startTimer;
document.getElementById("pauseTimerBtn").onclick = pauseTimer;
document.getElementById("resetTimerBtn").onclick = resetTimer;

/* 設定 */
document.getElementById("saveSettingsBtn").onclick = () => {
  const f = parseInt(document.getElementById("focusMinutesInput").value, 10);
  const b = parseInt(document.getElementById("breakMinutesInput").value, 10);

  if (f <= 0 || b <= 0) return showToast("分鐘必須大於 0", "warning");

  appData.settings.focusMinutes = f;
  appData.settings.breakMinutes = b;
  saveData();
  resetTimer();
  showToast("設定已儲存！", "success");
};

/* ====================================================
 *  8. 今日完成度
 * ==================================================== */
const todayStatsLabelEl = document.getElementById("todayStatsLabel");

function renderTodayStats() {
  const today = new Date().toISOString().slice(0, 10);

  const stats = appData.dailyStats[today];
  if (!stats) {
    todayStatsLabelEl.textContent = "今日尚無任務記錄";
    return;
  }

  todayStatsLabelEl.textContent = `完成 ${stats.done} / ${stats.total}`;
}

/* ====================================================
 *  9. 匯入匯出
 * ==================================================== */
document.getElementById("exportJsonBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "time-manager.json";
  a.click();

  URL.revokeObjectURL(url);
  showToast("資料已匯出！", "success");
};

document.getElementById("importJsonInput").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const parsed = JSON.parse(evt.target.result);
      appData = { ...appData, ...parsed };
      saveData();
      afterDataLoaded();
      showToast("匯入成功！", "success");
    } catch {
      showToast("匯入失敗：格式錯誤", "error");
    }
  };
  reader.readAsText(file);
};

/* ====================================================
 *  10. 拖曳排序
 * ==================================================== */
function initSortable() {
  if (sortableInitialized || !window.Sortable) return;

  new Sortable(taskListEl, {
    animation: 150,
    onSort: () => {
      const newOrder = [...taskListEl.children].map(
        (li) => li.dataset.taskId
      );
      reorderTasks(newOrder);
    },
  });

  sortableInitialized = true;
}

function reorderTasks(order) {
  const newList = [];
  order.forEach((id) => {
    const t = appData.tasks.find((x) => x.id === id);
    if (t) newList.push(t);
  });
  appData.tasks.forEach((t) => {
    if (!order.includes(t.id)) newList.push(t);
  });

  appData.tasks = newList;
  saveData();
  renderTaskList();
}

/* ====================================================
 *  11. Auth（登入、註冊、登出）
 * ==================================================== */
const authStatusLabelEl = document.getElementById("authStatusLabel");
const authActionBtnEl = document.getElementById("authActionBtn");

function updateAuthUI() {
  if (authState.mode === "user")
    authStatusLabelEl.textContent = `${authState.user.name}（登入中）`;
  else authStatusLabelEl.textContent = "Guest 模式";
}

/* Login + Register */
async function login(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  authState = { mode: "user", user: data.user, token: data.token };
  saveAuthState();

  await loadUserDataFromServer();
  showToast("登入成功！", "success");
}

async function register(name, email, password) {
  const data = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });

  authState = { mode: "user", user: data.user, token: data.token };
  saveAuthState();

  await apiRequest("/data/full", {
    method: "POST",
    headers: { Authorization: `Bearer ${authState.token}` },
    body: JSON.stringify(appData),
  });

  await loadUserDataFromServer();
  showToast("註冊成功！", "success");
}

/* Auth Modal */
const authModalEl = document.getElementById("authModal");
const authModalTitleEl = document.getElementById("authModalTitle");
const authNameGroupEl = document.getElementById("authNameGroup");
const authNameInputEl = document.getElementById("authNameInput");
const authEmailInputEl = document.getElementById("authEmailInput");
const authPasswordInputEl = document.getElementById("authPasswordInput");
const authSubmitBtnEl = document.getElementById("authSubmitBtn");
const authCancelBtnEl = document.getElementById("authCancelBtn");
const authToggleLabelEl = document.getElementById("authToggleLabel");
const authToggleBtnEl = document.getElementById("authToggleBtn");

let authMode = "login";

function openAuthModal(mode = "login") {
  authMode = mode;
  authModalEl.classList.remove("hidden");

  authEmailInputEl.value = "";
  authPasswordInputEl.value = "";
  authNameInputEl.value = "";

  if (mode === "login") {
    authModalTitleEl.textContent = "登入";
    authNameGroupEl.style.display = "none";
    authSubmitBtnEl.textContent = "登入";
    authToggleLabelEl.textContent = "還沒有帳號？";
    authToggleBtnEl.textContent = "建立帳號";
  } else {
    authModalTitleEl.textContent = "建立帳號";
    authNameGroupEl.style.display = "block";
    authSubmitBtnEl.textContent = "註冊";
    authToggleLabelEl.textContent = "已經有帳號？";
    authToggleBtnEl.textContent = "登入";
  }
}
function closeAuthModal() {
  authModalEl.classList.add("hidden");
}

/* Modal Events */
authToggleBtnEl.onclick = () => {
  openAuthModal(authMode === "login" ? "register" : "login");
};
authCancelBtnEl.onclick = closeAuthModal;
authSubmitBtnEl.onclick = async () => {
  const email = authEmailInputEl.value.trim();
  const password = authPasswordInputEl.value;
  const name = authNameInputEl.value.trim();

  if (!email || !password || (authMode === "register" && !name))
    return showToast("請填入所有欄位", "warning");

  try {
    if (authMode === "login") await login(email, password);
    else await register(name, email, password);

    closeAuthModal();
    afterDataLoaded();
    updateAuthUI();
  } catch (err) {
    showToast("登入 / 註冊失敗：" + err.message, "error");
  }
};

/* 登入按鈕 */
authActionBtnEl.addEventListener("click", () => {
  if (authState.mode === "user") {
    /* 登出 */
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    showToast("已登出，回到 Guest 模式！", "info");
  } else {
    openAuthModal("login");
  }
});

/* ====================================================
 *  12. 初始化
 * ==================================================== */
function afterDataLoaded() {
  document.getElementById("focusMinutesInput").value =
    appData.settings.focusMinutes;
  document.getElementById("breakMinutesInput").value =
    appData.settings.breakMinutes;

  /* Timer 初始 */
  timerState.mode = "focus";
  timerState.remainingSeconds = appData.settings.focusMinutes * 60;
  timerState.running = false;
  timerState.timerId = null;
  updateTimerDisplay();

  updateCurrentTaskLabel();
  updateAuthUI();
  renderTaskList();
  initSortable();
}

async function initApp() {
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch (err) {
      console.warn("Cloud load failed:", err);
      const raw = localStorage.getItem(LS_USER_CACHE_KEY);
      if (raw) appData = { ...appData, ...JSON.parse(raw) };
      else {
        authState = { mode: "guest", user: null, token: null };
        saveAuthState();
        loadGuestData();
      }
    }
  } else {
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
  }

  afterDataLoaded();
}

initApp();

/* ====================================================
 *  END
 * ==================================================== */
