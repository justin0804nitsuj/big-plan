/******************************************************
 *  Time Manager — D Version (Refactored + Settings)
 *  功能：
 *  - Guest / User 模式
 *  - 雲端同步（Render 後端）
 *  - 任務 CRUD、分類、排序
 *  - 番茄鐘
 *  - 今日完成度統計
 *  - 匯出 / 匯入 JSON
 *  - Toast 通知
 *  - 設定頁面：修改名稱 / 修改密碼 / 刪除帳號
 ******************************************************/

// ================== 1. 常數與狀態 ==================
const API_BASE = "https://big-plan.onrender.com";

const LS_AUTH_KEY = "tm_auth_v1";
const LS_GUEST_KEY = "tm_guest_v1";
const LS_USER_CACHE_KEY = "tm_user_cache_v1";

let authState = {
  mode: "guest", // "guest" | "user"
  user: null, // {id, name, email}
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

let timerState = {
  mode: "focus",
  remainingSeconds: appData.settings.focusMinutes * 60,
  timerId: null,
  running: false,
};

let currentFilter = "all";
let currentTaskIdForPomodoro = null;
let sortableInitialized = false;

// ================== 2. Toast 系統 ==================
function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("show"));

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 2400);
}

// ================== 3. Local Storage ==================
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

// ================== 4. API 封裝 ==================
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
      const j = await res.json();
      if (j && j.error) msg = j.error;
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
      console.warn("Save to server failed:", err.message);
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

// ================== 5. 任務邏輯 ==================
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

function addTask(task) {
  appData.tasks.push(task);
  saveData();
  renderTaskList();
  showToast("任務已新增", "success");
}

function updateTask(id, updates) {
  const idx = appData.tasks.findIndex((t) => t.id === id);
  if (idx < 0) return;
  appData.tasks[idx] = { ...appData.tasks[idx], ...updates };
  saveData();
  renderTaskList();
  showToast("任務已更新", "success");
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

// ================== 6. 任務 UI 渲染 ==================
const taskListEl = document.getElementById("taskList");
const filterButtons = document.querySelectorAll(".filter-btn");

const taskFormEl = document.getElementById("taskForm");
const taskIdEl = document.getElementById("taskId");
const taskTitleEl = document.getElementById("taskTitle");
const taskDescriptionEl = document.getElementById("taskDescription");
const taskDueDateEl = document.getElementById("taskDueDate");
const taskPriorityEl = document.getElementById("taskPriority");
const taskCategoryEl = document.getElementById("taskCategory");
const clearFormBtn = document.getElementById("clearFormBtn");

function renderTaskList() {
  taskListEl.innerHTML = "";

  const filtered = appData.tasks.filter((t) => {
    if (currentFilter === "todo") return t.status !== "done";
    if (currentFilter === "done") return t.status === "done";
    return true;
  });

  const statusOrder = { todo: 0, done: 1 };
  const priorityOrder = { high: 0, medium: 1, low: 2 };

  filtered.sort((a, b) => {
    if (statusOrder[a.status] !== statusOrder[b.status]) {
      return statusOrder[a.status] - statusOrder[b.status];
    }
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });

  filtered.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.status}`;
    li.dataset.taskId = task.id;

    const mainRow = document.createElement("div");
    mainRow.className = "task-main";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = task.status === "done";
    check.addEventListener("change", () => setTaskDone(task.id, check.checked));

    const titleSpan = document.createElement("span");
    titleSpan.textContent = task.title;
    if (task.status === "done") titleSpan.classList.add("done");

    mainRow.append(check, titleSpan);

    const meta1 = document.createElement("div");
    meta1.className = "task-meta";
    meta1.textContent = `截止：${task.dueDate || "無"}　優先度：${task.priority}`;

    const meta2 = document.createElement("div");
    meta2.className = "task-meta";
    meta2.textContent = `分類：${task.category || "無"}`;

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
    delBtn.className = "btn-small danger-btn";
    delBtn.textContent = "刪除";
    delBtn.onclick = () => deleteTask(task.id);

    actions.append(editBtn, bindBtn, delBtn);
    li.append(mainRow, meta1, meta2, actions);
    taskListEl.appendChild(li);
  });

  renderTodayStats();
  initSortable();
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

clearFormBtn.addEventListener("click", () => clearForm());

// 篩選
filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    filterButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    renderTaskList();
  })
);

// ================== 7. 番茄鐘 ==================
const currentTaskLabelEl = document.getElementById("currentTaskLabel");
const timerValueEl = document.getElementById("timerValue");
const focusMinutesInput = document.getElementById("focusMinutesInput");
const breakMinutesInput = document.getElementById("breakMinutesInput");

function updateCurrentTaskLabel() {
  if (!currentTaskIdForPomodoro) {
    currentTaskLabelEl.textContent = "尚未選擇任務";
    return;
  }
  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  currentTaskLabelEl.textContent = task ? task.title : "找不到任務";
}

function updateTimerDisplay() {
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  timerValueEl.textContent = `${String(m).padStart(2, "0")}:${String(
    s
  ).padStart(2, "0")}`;
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
  const base =
    timerState.mode === "focus"
      ? appData.settings.focusMinutes
      : appData.settings.breakMinutes;
  timerState.remainingSeconds = base * 60;
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
    showToast("專注時間結束，休息一下！", "info");
  } else {
    timerState.mode = "focus";
    timerState.remainingSeconds = appData.settings.focusMinutes * 60;
    showToast("休息結束，回來工作！", "success");
  }

  updateTimerDisplay();
}

// 按鈕
document.getElementById("startTimerBtn").onclick = startTimer;
document.getElementById("pauseTimerBtn").onclick = pauseTimer;
document.getElementById("resetTimerBtn").onclick = resetTimer;

// 設定
document.getElementById("saveSettingsBtn").onclick = () => {
  const f = parseInt(focusMinutesInput.value, 10);
  const b = parseInt(breakMinutesInput.value, 10);
  if (!f || f <= 0 || !b || b <= 0)
    return showToast("請輸入有效的分鐘數", "warning");
  appData.settings.focusMinutes = f;
  appData.settings.breakMinutes = b;
  saveData();
  resetTimer();
  showToast("番茄鐘設定已儲存", "success");
};

// ================== 8. 今日完成度 ==================
const todayStatsLabelEl = document.getElementById("todayStatsLabel");

function renderTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const stats = appData.dailyStats[today];
  if (!stats || stats.total === 0) {
    todayStatsLabelEl.textContent = "今日尚無任務記錄";
  } else {
    todayStatsLabelEl.textContent = `完成 ${stats.done} / ${stats.total}`;
  }
}

// ================== 9. 匯出 / 匯入 ==================
document.getElementById("exportJsonBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "time-manager-data.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("資料已匯出", "success");
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
      showToast("匯入成功", "success");
    } catch {
      showToast("匯入失敗：JSON 格式錯誤", "error");
    }
  };
  reader.readAsText(file);
};

// ================== 10. 拖曳排序 ==================
function initSortable() {
  if (sortableInitialized || !window.Sortable) return;
  new Sortable(taskListEl, {
    animation: 150,
    onSort: () => {
      const order = [...taskListEl.children].map((li) => li.dataset.taskId);
      const newTasks = [];
      order.forEach((id) => {
        const t = appData.tasks.find((x) => x.id === id);
        if (t) newTasks.push(t);
      });
      appData.tasks.forEach((t) => {
        if (!order.includes(t.id)) newTasks.push(t);
      });
      appData.tasks = newTasks;
      saveData();
      renderTaskList();
    },
  });
  sortableInitialized = true;
}

// ================== 11. Auth & 設定頁 ==================
const authStatusLabelEl = document.getElementById("authStatusLabel");
const authActionBtnEl = document.getElementById("authActionBtn");

// 設定頁 DOM
const mainContentEl = document.getElementById("mainContent");
const settingsPanelEl = document.getElementById("settingsPanel");
const openSettingsBtnEl = document.getElementById("openSettingsBtn");
const closeSettingsBtnEl = document.getElementById("closeSettingsBtn");
const settingsUserEmailEl = document.getElementById("settingsUserEmail");
const settingsUserNameEl = document.getElementById("settingsUserName");
const changeNameBtnEl = document.getElementById("changeNameBtn");
const newPasswordInputEl = document.getElementById("newPasswordInput");
const changePasswordBtnEl = document.getElementById("changePasswordBtn");
const deleteAccountBtnEl = document.getElementById("deleteAccountBtn");

// Auth Modal (若你之後要重新加 Modal 再補，這版先用 header 按鈕登入/登出)
function updateAuthUI() {
  if (authState.mode === "user" && authState.user) {
    authStatusLabelEl.textContent = `${authState.user.name}（登入中）`;
  } else {
    authStatusLabelEl.textContent = "Guest 模式";
  }
}

// Login / Register – 這版假設你用彈窗（後續若要完整 Modal，可再擴充）
async function login(email, password) {
  const data = await apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  authState = { mode: "user", user: data.user, token: data.token };
  saveAuthState();
  await loadUserDataFromServer();
  showToast("登入成功", "success");
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
  showToast("註冊成功", "success");
}

// 簡易 Prompt 版登入 / 註冊
authActionBtnEl.addEventListener("click", async () => {
  if (authState.mode === "user") {
    // 登出
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    showToast("已登出，回到 Guest 模式", "info");
    return;
  }

  // 讓使用者選擇登入或註冊
  const mode = prompt("輸入 1=登入, 2=註冊", "1");
  if (mode !== "1" && mode !== "2") return;

  const email = prompt("請輸入 Email：");
  const password = prompt("請輸入密碼：");
  if (!email || !password) {
    showToast("Email 或密碼不可空白", "warning");
    return;
  }

  try {
    if (mode === "1") {
      await login(email, password);
    } else {
      const name = prompt("請輸入名稱：");
      if (!name) {
        showToast("名稱不可空白", "warning");
        return;
      }
      await register(name, email, password);
    }
    afterDataLoaded();
    updateAuthUI();
  } catch (err) {
    showToast("登入 / 註冊失敗：" + err.message, "error");
  }
});

// ====== 設定頁顯示 / 關閉 ======
function openSettingsPanel() {
  if (authState.mode !== "user" || !authState.user) {
    showToast("請先登入才能使用設定頁", "warning");
    return;
  }
  mainContentEl.classList.add("hidden");
  settingsPanelEl.classList.remove("hidden");
  settingsUserEmailEl.textContent = authState.user.email;
  settingsUserNameEl.textContent = authState.user.name;
}

function closeSettingsPanel() {
  settingsPanelEl.classList.add("hidden");
  mainContentEl.classList.remove("hidden");
}

openSettingsBtnEl.addEventListener("click", openSettingsPanel);
closeSettingsBtnEl.addEventListener("click", closeSettingsPanel);

// 修改名稱
changeNameBtnEl.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.user) {
    return showToast("請先登入", "warning");
  }
  const newName = prompt("請輸入新名稱：", authState.user.name || "");
  if (!newName) return;

  try {
    const data = await apiRequest("/auth/change-name", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ name: newName }),
    });
    authState.user = data.user;
    authState.token = data.token;
    saveAuthState();
    settingsUserNameEl.textContent = data.user.name;
    updateAuthUI();
    showToast("名稱已更新", "success");
  } catch (err) {
    showToast("更新名稱失敗：" + err.message, "error");
  }
});

// 修改密碼
changePasswordBtnEl.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.user) {
    return showToast("請先登入", "warning");
  }
  const newPw = newPasswordInputEl.value;
  if (!newPw || newPw.length < 6) {
    return showToast("新密碼至少 6 碼", "warning");
  }

  try {
    await apiRequest("/auth/change-password", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ newPassword: newPw }),
    });
    newPasswordInputEl.value = "";
    showToast("密碼已更新", "success");
  } catch (err) {
    showToast("更新密碼失敗：" + err.message, "error");
  }
});

// 刪除帳號
deleteAccountBtnEl.addEventListener("click", async () => {
  if (authState.mode !== "user" || !authState.user) {
    return showToast("尚未登入", "warning");
  }

  const sure = confirm("確定要刪除帳號？此動作無法復原！");
  if (!sure) return;

  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` },
    });

    // 刪除成功 → 回到 guest
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    localStorage.removeItem(LS_USER_CACHE_KEY);
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    closeSettingsPanel();
    showToast("帳號已刪除，回到 Guest 模式", "info");
  } catch (err) {
    showToast("刪除帳號失敗：" + err.message, "error");
  }
});

// ================== 12. 初始化 ==================
function afterDataLoaded() {
  focusMinutesInput.value = appData.settings.focusMinutes;
  breakMinutesInput.value = appData.settings.breakMinutes;

  timerState.mode = "focus";
  timerState.remainingSeconds = appData.settings.focusMinutes * 60;
  timerState.running = false;
  timerState.timerId = null;

  updateTimerDisplay();
  updateCurrentTaskLabel();
  renderTaskList();
  renderTodayStats();
  updateAuthUI();
  initSortable();
}

async function initApp() {
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch (err) {
      console.warn("載入雲端資料失敗，改用 cache / guest：", err.message);
      const raw = localStorage.getItem(LS_USER_CACHE_KEY);
      if (raw) {
        appData = { ...appData, ...JSON.parse(raw) };
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
}

initApp();
