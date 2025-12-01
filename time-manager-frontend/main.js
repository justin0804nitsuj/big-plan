// ====== Auth & Storage Keys ======
const LS_GUEST_KEY = "timeManager_guest_v1";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v1";
const LS_AUTH_KEY = "timeManager_auth_v1";

// 後端 API base URL
const API_BASE = "http://localhost:4000";

// mode: "guest" 或 "user"
let authState = {
  mode: "guest",
  user: null,
  token: null,
};

function loadAuthState() {
  const raw = localStorage.getItem(LS_AUTH_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && (parsed.mode === "guest" || parsed.mode === "user")) {
      authState = parsed;
    }
  } catch (e) {
    console.error("Failed to parse auth state:", e);
  }
}

function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

// ====== App Data ======
let appData = {
  tasks: [],
  pomodoroHistory: [],
  settings: {
    focusMinutes: 25,
    breakMinutes: 5,
  },
  dailyStats: {}, // "YYYY-MM-DD": { done, total }
};

// ====== Guest / User 資料載入與儲存 ======
function loadGuestData() {
  const raw = localStorage.getItem(LS_GUEST_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    appData = { ...appData, ...parsed };
  } catch (e) {
    console.error("Failed to parse guest data:", e);
  }
}

function saveGuestData() {
  localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
}

function loadUserCacheData() {
  const raw = localStorage.getItem(LS_USER_CACHE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    appData = { ...appData, ...parsed };
  } catch (e) {
    console.error("Failed to parse user cache:", e);
  }
}

function saveUserCacheData() {
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
}

// ====== 對後端 API 的封裝 ======
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
      const errJson = await res.json();
      if (errJson && errJson.error) msg = errJson.error;
    } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// 從伺服器載入完整 appData
async function loadUserDataFromServer() {
  if (!authState.token) throw new Error("No token");

  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${authState.token}`,
    },
  });

  appData = { ...appData, ...data };
  saveUserCacheData();
}

// 把完整 appData 存到伺服器（有 debounce）
let saveServerTimeoutId = null;
function scheduleSaveDataToServer() {
  if (!authState.token) return;
  if (saveServerTimeoutId) {
    clearTimeout(saveServerTimeoutId);
  }
  saveServerTimeoutId = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authState.token}`,
        },
        body: JSON.stringify(appData),
      });
    } catch (err) {
      console.warn("Failed to save data to server:", err.message);
    }
  }, 500); // 0.5 秒內多次變更只送一次
}

// 對外統一 saveData：guest 本地、user 雲端＋cache
function saveData() {
  if (authState.mode === "guest") {
    saveGuestData();
  } else {
    saveUserCacheData();
    scheduleSaveDataToServer();
  }
}

// ====== DOM Elements ======
const taskListEl = document.getElementById("taskList");
const taskFormEl = document.getElementById("taskForm");
const taskIdEl = document.getElementById("taskId");
const taskTitleEl = document.getElementById("taskTitle");
const taskDescriptionEl = document.getElementById("taskDescription");
const taskDueDateEl = document.getElementById("taskDueDate");
const taskPriorityEl = document.getElementById("taskPriority");
const taskCategoryEl = document.getElementById("taskCategory");
const clearFormBtn = document.getElementById("clearFormBtn");
const filterButtons = document.querySelectorAll(".filter-btn");

const todayStatsLabelEl = document.getElementById("todayStatsLabel");

// Pomodoro
const timerModeLabelEl = document.getElementById("timerModeLabel");
const timerValueEl = document.getElementById("timerValue");
const currentTaskLabelEl = document.getElementById("currentTaskLabel");

const startTimerBtn = document.getElementById("startTimerBtn");
const pauseTimerBtn = document.getElementById("pauseTimerBtn");
const resetTimerBtn = document.getElementById("resetTimerBtn");

const focusMinutesInput = document.getElementById("focusMinutesInput");
const breakMinutesInput = document.getElementById("breakMinutesInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

// 匯入 / 匯出
const exportJsonBtn = document.getElementById("exportJsonBtn");
const importJsonInput = document.getElementById("importJsonInput");

// Auth UI
const authStatusLabelEl = document.getElementById("authStatusLabel");
const authActionBtnEl = document.getElementById("authActionBtn");

// Auth Modal
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

// login / register 模式
let authModalMode = "login"; // "login" or "register"

// 狀態
let currentFilter = "all";
let currentTaskIdForPomodoro = null;

let timerState = {
  mode: "focus",
  remainingSeconds: appData.settings.focusMinutes * 60,
  timerId: null,
  running: false,
};

let sortableInitialized = false;

// ====== Utils ======
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

// ====== Task Management ======
function addTask(task) {
  appData.tasks.push(task);
  saveData();
  renderTaskList();
}

function updateTask(id, updates) {
  const idx = appData.tasks.findIndex((t) => t.id === id);
  if (idx >= 0) {
    appData.tasks[idx] = { ...appData.tasks[idx], ...updates };
    saveData();
    renderTaskList();
  }
}

function deleteTask(id) {
  appData.tasks = appData.tasks.filter((t) => t.id !== id);

  if (currentTaskIdForPomodoro === id) {
    currentTaskIdForPomodoro = null;
    updateCurrentTaskLabel();
  }

  saveData();
  renderTaskList();
}

function setTaskDone(id, done) {
  updateTask(id, { status: done ? "done" : "todo" });

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = appData.tasks.filter((t) => t.dueDate === today);

  if (!appData.dailyStats[today]) {
    appData.dailyStats[today] = { done: 0, total: 0 };
  }

  appData.dailyStats[today] = {
    done: todayTasks.filter((t) => t.status === "done").length,
    total: todayTasks.length,
  };

  saveData();
  renderTodayStats();
}

function renderTaskList() {
  taskListEl.innerHTML = "";

  const filteredTasks = appData.tasks.filter((task) => {
    if (currentFilter === "todo") return task.status !== "done";
    if (currentFilter === "done") return task.status === "done";
    return true;
  });

  filteredTasks.sort((a, b) => {
    const statusOrder = { todo: 0, done: 1 };
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  filteredTasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.status}`;
    li.setAttribute("data-task-id", task.id);

    const mainRow = document.createElement("div");
    mainRow.className = "task-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.status === "done";
    checkbox.addEventListener("change", () => {
      setTaskDone(task.id, checkbox.checked);
    });

    const titleSpan = document.createElement("span");
    titleSpan.className =
      "task-title" + (task.status === "done" ? " done" : "");
    titleSpan.textContent = task.title;

    mainRow.appendChild(checkbox);
    mainRow.appendChild(titleSpan);

    const metaRow = document.createElement("div");
    metaRow.className = "task-meta";

    const dueLabel = document.createElement("span");
    dueLabel.textContent = task.dueDate
      ? `截止：${task.dueDate}`
      : "截止：無";

    const priorityLabel = document.createElement("span");
    const priorityMap = { low: "Low", medium: "Medium", high: "High" };
    priorityLabel.textContent = `優先度：${priorityMap[task.priority] || "-"}`;

    metaRow.appendChild(dueLabel);
    metaRow.appendChild(priorityLabel);

    const metaRow2 = document.createElement("div");
    metaRow2.className = "task-meta";
    const categoryLabel = document.createElement("span");
    categoryLabel.textContent = task.category
      ? `分類：${task.category}`
      : "分類：無";
    metaRow2.appendChild(categoryLabel);

    const actionsRow = document.createElement("div");
    actionsRow.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = "編輯";
    editBtn.className = "btn-small";
    editBtn.addEventListener("click", () => {
      fillFormForEdit(task);
    });

    const bindBtn = document.createElement("button");
    bindBtn.textContent = "綁定番茄鐘";
    bindBtn.className = "btn-small";
    bindBtn.addEventListener("click", () => {
      currentTaskIdForPomodoro = task.id;
      updateCurrentTaskLabel();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "刪除";
    deleteBtn.className = "btn-small";
    deleteBtn.style.background = "#c0392b";
    deleteBtn.style.color = "#fff";
    deleteBtn.addEventListener("click", () => {
      if (confirm("確定刪除這個任務？")) {
        deleteTask(task.id);
      }
    });

    actionsRow.appendChild(editBtn);
    actionsRow.appendChild(bindBtn);
    actionsRow.appendChild(deleteBtn);

    li.appendChild(mainRow);
    li.appendChild(metaRow);
    li.appendChild(metaRow2);
    li.appendChild(actionsRow);

    taskListEl.appendChild(li);
  });

  renderTodayStats();
}

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

// 表單事件
taskFormEl.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = taskIdEl.value;
  const title = taskTitleEl.value.trim();
  if (!title) {
    alert("請輸入任務標題");
    return;
  }

  const taskData = {
    title,
    description: taskDescriptionEl.value.trim(),
    dueDate: taskDueDateEl.value || "",
    priority: taskPriorityEl.value,
    category: taskCategoryEl.value || "",
  };

  if (id) {
    updateTask(id, taskData);
  } else {
    addTask({
      id: createId("t"),
      status: "todo",
      ...taskData,
    });
  }

  clearForm();
});

clearFormBtn.addEventListener("click", () => {
  clearForm();
});

// Filter
filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.getAttribute("data-filter");
    renderTaskList();
  });
});

// ====== Pomodoro ======
function updateCurrentTaskLabel() {
  if (!currentTaskIdForPomodoro) {
    currentTaskLabelEl.textContent = "尚未選擇任務";
    return;
  }
  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  if (!task) {
    currentTaskLabelEl.textContent = "找不到任務（可能被刪除）";
    return;
  }
  currentTaskLabelEl.textContent = task.title;
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  timerValueEl.textContent =
    String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");

  timerModeLabelEl.textContent =
    timerState.mode === "focus" ? "專注時間" : "休息時間";
}

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;

  if (!timerState.timerId) {
    timerState.timerId = setInterval(() => {
      timerState.remainingSeconds--;
      if (timerState.remainingSeconds <= 0) {
        handleTimerFinished();
      }
      updateTimerDisplay();
    }, 1000);
  }
}

function pauseTimer() {
  timerState.running = false;
  if (timerState.timerId) {
    clearInterval(timerState.timerId);
    timerState.timerId = null;
  }
}

function resetTimer() {
  pauseTimer();
  const mins =
    timerState.mode === "focus"
      ? appData.settings.focusMinutes
      : appData.settings.breakMinutes;
  timerState.remainingSeconds = mins * 60;
  updateTimerDisplay();
}

function handleTimerFinished() {
  pauseTimer();

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

  if (timerState.mode === "focus") {
    timerState.mode = "break";
    timerState.remainingSeconds = appData.settings.breakMinutes * 60;
    alert("專注時間結束，休息一下！");
  } else {
    timerState.mode = "focus";
    timerState.remainingSeconds = appData.settings.focusMinutes * 60;
    alert("休息結束，可以回來工作啦！");
  }

  updateTimerDisplay();
}

// Pomodoro 按鈕
startTimerBtn.addEventListener("click", () => {
  startTimer();
});
pauseTimerBtn.addEventListener("click", () => {
  pauseTimer();
});
resetTimerBtn.addEventListener("click", () => {
  resetTimer();
});

// 設定儲存
saveSettingsBtn.addEventListener("click", () => {
  const focusMins = parseInt(focusMinutesInput.value, 10);
  const breakMins = parseInt(breakMinutesInput.value, 10);
  if (!focusMins || focusMins <= 0 || !breakMins || breakMins <= 0) {
    alert("請輸入有效的分鐘數（>0）");
    return;
  }

  appData.settings.focusMinutes = focusMins;
  appData.settings.breakMinutes = breakMins;
  saveData();

  resetTimer();
  alert("設定已儲存");
});

// ====== 今日完成度 ======
function renderTodayStats() {
  if (!todayStatsLabelEl) return;
  const today = new Date().toISOString().slice(0, 10);
  const stats = appData.dailyStats[today];

  if (!stats || stats.total === 0) {
    todayStatsLabelEl.textContent = "今日尚無任務記錄";
    return;
  }

  todayStatsLabelEl.textContent = `完成 ${stats.done} / ${stats.total} 個任務`;
}

// ====== 匯出 / 匯入 JSON ======
exportJsonBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "time-manager-data.json";
  a.click();
  URL.revokeObjectURL(url);
});

importJsonInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);
      appData = { ...appData, ...parsed };
      saveData();
      afterDataLoaded();
      alert("匯入成功");
    } catch (err) {
      console.error(err);
      alert("匯入失敗：JSON 格式錯誤");
    }
  };
  reader.readAsText(file);
});

// ====== 任務排序（Sortable.js） ======
function initSortable() {
  if (sortableInitialized) return;
  if (!window.Sortable) return;

  new Sortable(taskListEl, {
    animation: 150,
    ghostClass: "drag-ghost",
    onSort: function () {
      const newOrder = [...taskListEl.children].map((li) =>
        li.getAttribute("data-task-id")
      );
      reorderTasks(newOrder);
    },
  });

  sortableInitialized = true;
}

function reorderTasks(newOrder) {
  const newTasks = [];
  newOrder.forEach((id) => {
    const t = appData.tasks.find((task) => task.id === id);
    if (t) newTasks.push(t);
  });

  appData.tasks.forEach((t) => {
    if (!newOrder.includes(t.id)) newTasks.push(t);
  });

  appData.tasks = newTasks;
  saveData();
  renderTaskList();
}

// ====== Auth：登入/註冊/登出（前端部分） ======
function updateAuthUI() {
  if (!authStatusLabelEl || !authActionBtnEl) return;

  if (authState.mode === "user" && authState.user) {
    authStatusLabelEl.textContent = `${authState.user.name}（登入中）`;
    authActionBtnEl.textContent = "登出";
  } else {
    authStatusLabelEl.textContent = "Guest 模式";
    authActionBtnEl.textContent = "登入 / 建立帳號";
  }
}

async function loginWithEmailPassword(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });

  authState = {
    mode: "user",
    user: data.user,
    token: data.token,
  };
  saveAuthState();

  await loadUserDataFromServer();
}

async function registerWithEmailPassword(name, email, password) {
  const data = await apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ name, email, password }),
  });

  authState = {
    mode: "user",
    user: data.user,
    token: data.token,
  };
  saveAuthState();

  await apiRequest("/data/full", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authState.token}`,
    },
    body: JSON.stringify(appData),
  });

  await loadUserDataFromServer();
}

// Modal 模式切換
function setAuthModalMode(mode) {
  authModalMode = mode;
  if (!authModalEl) return;

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
    authToggleLabelEl.textContent = "已經有帳號了？";
    authToggleBtnEl.textContent = "改為登入";
  }
}

function openAuthModal(initialMode = "login") {
  if (!authModalEl) return;
  setAuthModalMode(initialMode);
  authNameInputEl.value = "";
  authEmailInputEl.value = "";
  authPasswordInputEl.value = "";
  authModalEl.classList.remove("hidden");
}

function closeAuthModal() {
  if (!authModalEl) return;
  authModalEl.classList.add("hidden");
}

// Modal 事件
if (authToggleBtnEl) {
  authToggleBtnEl.addEventListener("click", () => {
    setAuthModalMode(authModalMode === "login" ? "register" : "login");
  });
}

if (authCancelBtnEl) {
  authCancelBtnEl.addEventListener("click", () => {
    closeAuthModal();
  });
}

if (authSubmitBtnEl) {
  authSubmitBtnEl.addEventListener("click", async () => {
    const email = authEmailInputEl.value.trim();
    const password = authPasswordInputEl.value;
    const name = authNameInputEl.value.trim();

    if (!email || !password || (authModalMode === "register" && !name)) {
      alert("請填寫完整欄位");
      return;
    }

    try {
      if (authModalMode === "login") {
        await loginWithEmailPassword(email, password);
        afterDataLoaded();
        updateAuthUI();
        alert("登入成功，已載入雲端資料。");
      } else {
        await registerWithEmailPassword(name, email, password);
        afterDataLoaded();
        updateAuthUI();
        alert("註冊成功，已將目前的任務資料上傳到雲端。");
      }
      closeAuthModal();
    } catch (err) {
      console.error(err);
      alert("登入 / 註冊失敗：" + err.message);
    }
  });
}

// Header 登入／登出按鈕
if (authActionBtnEl) {
  authActionBtnEl.addEventListener("click", async () => {
    if (authState.mode === "user") {
      // 登出
      if (!confirm("確定要登出嗎？")) return;

      authState = {
        mode: "guest",
        user: null,
        token: null,
      };
      saveAuthState();

      // 回到 guest 資料
      appData = {
        tasks: [],
        pomodoroHistory: [],
        settings: appData.settings,
        dailyStats: {},
      };
      loadGuestData();
      afterDataLoaded();
      updateAuthUI();
      alert("已登出，回到 Guest 模式（本機資料）。");
    } else {
      // Guest → 打開登入/註冊 Modal（預設登入）
      openAuthModal("login");
    }
  });
}

// ====== 初始化 ======
function afterDataLoaded() {
  focusMinutesInput.value = appData.settings.focusMinutes;
  breakMinutesInput.value = appData.settings.breakMinutes;

  timerState.mode = "focus";
  timerState.remainingSeconds = appData.settings.focusMinutes * 60;
  timerState.timerId = null;
  timerState.running = false;
  updateTimerDisplay();

  renderTaskList();
  updateCurrentTaskLabel();
  initSortable();
  updateAuthUI();
}

async function initApp() {
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch (err) {
      console.warn("載入雲端資料失敗，改用 cache 或 guest：", err.message);
      const cacheRaw = localStorage.getItem(LS_USER_CACHE_KEY);
      if (cacheRaw) {
        appData = { ...appData, ...JSON.parse(cacheRaw) };
      } else {
        authState = { mode: "guest", user: null, token: null };
        saveAuthState();
        loadGuestData();
      }
    }
  } else {
    authState.mode = "guest";
    saveAuthState();
    loadGuestData();
  }

  afterDataLoaded();
}

initApp();
