/* ======================================================
   Local Storage Keys & API Base
====================================================== */
const LS_GUEST_KEY = "timeManager_guest_v1";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v1";
const LS_AUTH_KEY = "timeManager_auth_v1";

const API_BASE = "https://big-plan.onrender.com";

/* ======================================================
   Global State
====================================================== */
let authState = {
  mode: "guest", // "guest" or "user"
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
  dailyStats: {}, // "YYYY-MM-DD": { done, total }
};

let currentFilter = "all";
let currentTaskIdForPomodoro = null;

let timerState = {
  mode: "focus",
  remainingSeconds: 25 * 60,
  running: false,
  timerId: null,
};

/* ======================================================
   Utils
====================================================== */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/* Toast：右下角黑底白字 + 紅框 */
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // 觸發動畫
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 2400);
}

/* ======================================================
   Auth State Load / Save
====================================================== */
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

/* ======================================================
   Guest / User Data Load / Save
====================================================== */
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

/* ======================================================
   API Wrapper
====================================================== */
async function apiRequest(path, options = {}) {
  const url = API_BASE + path;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

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

/* ======================================================
   Server Data Load / Save
====================================================== */
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

let saveServerTimeout = null;

function scheduleSaveDataToServer() {
  if (!authState.token) return;
  if (saveServerTimeout) clearTimeout(saveServerTimeout);

  saveServerTimeout = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authState.token}`,
        },
        body: JSON.stringify(appData),
      });
    } catch (err) {
      console.warn("Failed to save data to server:", err);
      showToast("雲端同步失敗（稍後自動重試）");
    }
  }, 500);
}

function saveData() {
  if (authState.mode === "guest") {
    saveGuestData();
  } else {
    saveUserCacheData();
    scheduleSaveDataToServer();
  }
}

/* ======================================================
   DOM Elements
====================================================== */
// Task
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

// Stats
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

// Import / Export
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

// Settings Drawer
const settingsDrawerEl = document.getElementById("settingsDrawer");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");
const settingsUserEmailEl = document.getElementById("settingsUserEmail");
const settingsUserNameEl = document.getElementById("settingsUserName");
const changeNameBtn = document.getElementById("changeNameBtn");
const newPasswordInputEl = document.getElementById("newPasswordInput");
const changePasswordBtn = document.getElementById("changePasswordBtn");
const deleteAccountBtn = document.getElementById("deleteAccountBtn");

/* ======================================================
   Task Management
====================================================== */
function renderTaskList() {
  taskListEl.innerHTML = "";

  let filteredTasks = appData.tasks.filter((task) => {
    if (currentFilter === "todo") return task.status !== "done";
    if (currentFilter === "done") return task.status === "done";
    return true;
  });

  filteredTasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.category = task.category || "";
    li.dataset.taskId = task.id;
    if (task.status === "done") li.classList.add("done");

    const main = document.createElement("div");
    main.className = "task-main";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.status === "done";

    const titleSpan = document.createElement("span");
    titleSpan.className = "task-title";
    titleSpan.textContent = task.title;

    main.appendChild(checkbox);
    main.appendChild(titleSpan);

    const meta1 = document.createElement("div");
    meta1.className = "task-meta";
    meta1.textContent = `截止：${task.dueDate || "無"}　|　優先度：${task.priority}`;

    const meta2 = document.createElement("div");
    meta2.className = "task-meta";
    meta2.textContent = `分類：${task.category || "無"}`;

    const actions = document.createElement("div");
    actions.className = "task-actions";

    const editBtn = document.createElement("button");
    editBtn.textContent = "編輯";
    editBtn.classList.add("small");

    const bindBtn = document.createElement("button");
    bindBtn.textContent = "綁定番茄鐘";
    bindBtn.classList.add("small");

    const delBtn = document.createElement("button");
    delBtn.textContent = "刪除";
    delBtn.classList.add("small", "danger");

    actions.appendChild(editBtn);
    actions.appendChild(bindBtn);
    actions.appendChild(delBtn);

    li.appendChild(main);
    li.appendChild(meta1);
    li.appendChild(meta2);
    li.appendChild(actions);

    // Events
    checkbox.addEventListener("change", () => {
      setTaskDone(task.id, checkbox.checked);
    });

    editBtn.addEventListener("click", () => {
      fillFormForEdit(task);
    });

    bindBtn.addEventListener("click", () => {
      currentTaskIdForPomodoro = task.id;
      updateCurrentTaskLabel();
      showToast("已綁定番茄鐘");
    });

    delBtn.addEventListener("click", () => {
      if (confirm("確定刪除任務？")) {
        deleteTask(task.id);
      }
    });

    taskListEl.appendChild(li);
  });

  renderTodayStats();
}

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
  saveData();
  renderTaskList();
}

function setTaskDone(id, done) {
  updateTask(id, { status: done ? "done" : "todo" });

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = appData.tasks.filter((t) => t.dueDate === today);

  appData.dailyStats[today] = {
    done: todayTasks.filter((t) => t.status === "done").length,
    total: todayTasks.length,
  };

  saveData();
}

/* Task Form */
taskFormEl.addEventListener("submit", (e) => {
  e.preventDefault();

  const id = taskIdEl.value;
  const title = taskTitleEl.value.trim();
  if (!title) {
    showToast("請輸入任務標題");
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
  showToast("任務已儲存");
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

clearFormBtn.addEventListener("click", clearForm);

/* Filter Buttons */
filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.getAttribute("data-filter");
    renderTaskList();
  });
});

/* ======================================================
   Today Stats
====================================================== */
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

/* ======================================================
   Pomodoro
====================================================== */
function updateCurrentTaskLabel() {
  if (!currentTaskIdForPomodoro) {
    currentTaskLabelEl.textContent = "尚未選擇任務";
    return;
  }
  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  if (!task) {
    currentTaskLabelEl.textContent = "找不到任務（可能已刪除）";
    return;
  }
  currentTaskLabelEl.textContent = task.title;
}

function updateTimerDisplay() {
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  timerValueEl.textContent =
    String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
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
    showToast("專注結束，休息一下！");
  } else {
    timerState.mode = "focus";
    timerState.remainingSeconds = appData.settings.focusMinutes * 60;
    showToast("休息結束，回來工作吧！");
  }

  updateTimerDisplay();
}

startTimerBtn.addEventListener("click", startTimer);
pauseTimerBtn.addEventListener("click", pauseTimer);
resetTimerBtn.addEventListener("click", resetTimer);

/* 設定儲存 */
saveSettingsBtn.addEventListener("click", () => {
  const focusMins = parseInt(focusMinutesInput.value, 10);
  const breakMins = parseInt(breakMinutesInput.value, 10);

  if (!focusMins || focusMins <= 0 || !breakMins || breakMins <= 0) {
    showToast("請輸入有效的分鐘數（>0）");
    return;
  }

  appData.settings.focusMinutes = focusMins;
  appData.settings.breakMinutes = breakMins;
  saveData();
  resetTimer();
  showToast("番茄鐘設定已更新");
});

/* ======================================================
   Import / Export JSON
====================================================== */
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
      showToast("匯入成功");
    } catch (err) {
      console.error(err);
      showToast("匯入失敗：JSON 格式錯誤");
    }
  };
  reader.readAsText(file);
});

/* ======================================================
   Auth：登入 / 註冊（Modal）
====================================================== */
let authModalMode = "login"; // "login" 或 "register"

function setAuthModalMode(mode) {
  authModalMode = mode;
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
    authToggleBtnEl.textContent = "改為登入";
  }
}

function openAuthModal(initialMode = "login") {
  setAuthModalMode(initialMode);
  authNameInputEl.value = "";
  authEmailInputEl.value = "";
  authPasswordInputEl.value = "";
  authModalEl.classList.remove("hidden");
}

function closeAuthModal() {
  authModalEl.classList.add("hidden");
}

authToggleBtnEl.addEventListener("click", () => {
  setAuthModalMode(authModalMode === "login" ? "register" : "login");
});

authCancelBtnEl.addEventListener("click", () => {
  closeAuthModal();
});

/* 後端登入 / 註冊 */
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

  // 初次註冊，把本地資料上傳
  await apiRequest("/data/full", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${authState.token}`,
    },
    body: JSON.stringify(appData),
  });

  await loadUserDataFromServer();
}

/* Modal 送出 */
authSubmitBtnEl.addEventListener("click", async () => {
  const name = authNameInputEl.value.trim();
  const email = authEmailInputEl.value.trim();
  const password = authPasswordInputEl.value;

  if (!email || !password || (authModalMode === "register" && !name)) {
    showToast("請填寫完整欄位");
    return;
  }

  try {
    if (authModalMode === "login") {
      await loginWithEmailPassword(email, password);
      showToast("登入成功");
    } else {
      await registerWithEmailPassword(name, email, password);
      showToast("註冊成功");
    }

    afterDataLoaded();
    updateAuthUI();
    closeAuthModal();
  } catch (err) {
    console.error(err);
    showToast("登入 / 註冊失敗：" + err.message);
  }
});

/* Header 登入 / 登出按鈕 */
authActionBtnEl.addEventListener("click", () => {
  if (authState.mode === "user") {
    // 登出
    if (!confirm("確定要登出嗎？")) return;

    authState = { mode: "guest", user: null, token: null };
    saveAuthState();

    // 回到 guest data
    appData = {
      tasks: [],
      pomodoroHistory: [],
      settings: appData.settings,
      dailyStats: {},
    };
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    showToast("已登出，回到 Guest 模式");
  } else {
    openAuthModal("login");
  }
});

/* ======================================================
   Settings Drawer：修改名稱 / 密碼 / 刪除帳號
====================================================== */
openSettingsBtn.addEventListener("click", () => {
  if (authState.mode !== "user" || !authState.user) {
    showToast("請先登入帳號才能開啟設定");
    return;
  }
  settingsUserEmailEl.textContent = authState.user.email;
  settingsUserNameEl.textContent = authState.user.name;
  settingsDrawerEl.classList.add("open");
});

closeSettingsBtn.addEventListener("click", () => {
  settingsDrawerEl.classList.remove("open");
});

/* 修改名稱 */
changeNameBtn.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.token) {
    showToast("請先登入帳號");
    return;
  }
  const newName = prompt("請輸入新名稱：", authState.user?.name || "");
  if (!newName) return;

  try {
    const data = await apiRequest("/auth/update-name", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
      body: JSON.stringify({ name: newName }),
    });

    authState.user = data.user;
    saveAuthState();
    settingsUserNameEl.textContent = data.user.name;
    updateAuthUI();
    showToast("名稱已更新");
  } catch (err) {
    console.error(err);
    showToast("更新名稱失敗：" + err.message);
  }
});

/* 修改密碼 */
changePasswordBtn.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.token) {
    showToast("請先登入帳號");
    return;
  }
  const newPassword = newPasswordInputEl.value;
  if (!newPassword) {
    showToast("請輸入新密碼");
    return;
  }

  try {
    await apiRequest("/auth/update-password", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
      body: JSON.stringify({ password: newPassword }),
    });

    newPasswordInputEl.value = "";
    showToast("密碼已更新");
  } catch (err) {
    console.error(err);
    showToast("更新密碼失敗：" + err.message);
  }
});

/* 刪除帳號 */
deleteAccountBtn.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.token) {
    showToast("尚未登入");
    return;
  }
  if (
    !confirm(
      "確定要永久刪除帳號嗎？所有雲端資料將無法恢復，並回到 Guest 模式。"
    )
  ) {
    return;
  }

  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authState.token}`,
      },
    });

    showToast("帳號已刪除");

    authState = { mode: "guest", user: null, token: null };
    saveAuthState();

    appData = {
      tasks: [],
      pomodoroHistory: [],
      settings: appData.settings,
      dailyStats: {},
    };
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    settingsDrawerEl.classList.remove("open");
  } catch (err) {
    console.error(err);
    showToast("刪除帳號失敗：" + err.message);
  }
});

/* ======================================================
   UI Init
====================================================== */
function updateAuthUI() {
  if (authState.mode === "user" && authState.user) {
    authStatusLabelEl.textContent = `${authState.user.name}（登入中）`;
    authActionBtnEl.textContent = "登出";

    // 同步設定 panel 顯示
    settingsUserEmailEl.textContent = authState.user.email || "-";
    settingsUserNameEl.textContent = authState.user.name || "-";
  } else {
    authStatusLabelEl.textContent = "Guest 模式";
    authActionBtnEl.textContent = "登入 / 註冊";

    settingsUserEmailEl.textContent = "-";
    settingsUserNameEl.textContent = "-";
  }
}

function afterDataLoaded() {
  focusMinutesInput.value = appData.settings.focusMinutes;
  breakMinutesInput.value = appData.settings.breakMinutes;

  timerState.mode = "focus";
  timerState.remainingSeconds = appData.settings.focusMinutes * 60;
  timerState.running = false;
  if (timerState.timerId) {
    clearInterval(timerState.timerId);
    timerState.timerId = null;
  }
  updateTimerDisplay();

  renderTaskList();
  updateCurrentTaskLabel();
}

/* 初始化 App */
async function initApp() {
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch (err) {
      console.warn("載入雲端資料失敗，改用快取或 Guest：", err.message);
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
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
  }

  afterDataLoaded();
  updateAuthUI();
}

initApp();
