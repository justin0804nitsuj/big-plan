/* ======================================================
   Auth / Storage Keys
====================================================== */
const LS_GUEST_KEY = "timeManager_guest_v1";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v1";
const LS_AUTH_KEY = "timeManager_auth_v1";

const API_BASE = "https://big-plan.onrender.com";

/* ======================================================
   全域狀態
====================================================== */
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

let currentFilter = "all";
let currentTaskIdForPomodoro = null;

let timerState = {
  mode: "focus",
  remainingSeconds: 1500,
  running: false,
  timerId: null,
};

let weeklyChart = null;

/* ======================================================
   Utils
====================================================== */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

/* ======================================================
   Toast — 黑底白字 + 紅框（右下角）
====================================================== */
function showToast(message) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 350);
  }, 2400);
}

/* ======================================================
   Auth 狀態儲存
====================================================== */
function loadAuthState() {
  const raw = localStorage.getItem(LS_AUTH_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    authState = parsed;
  } catch {}
}

function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

/* ======================================================
   Guest / User Data Load
====================================================== */
function loadGuestData() {
  const raw = localStorage.getItem(LS_GUEST_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    appData = { ...appData, ...parsed };
  } catch {}
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
  } catch {}
}

function saveUserCacheData() {
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
}

/* ======================================================
   API Request 包裝
====================================================== */
async function apiRequest(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try {
      const errJson = await res.json();
      if (errJson.error) msg = errJson.error;
    } catch {}
    throw new Error(msg);
  }

  if (res.status === 204) return null;
  return res.json();
}

/* ======================================================
   從伺服器載入 / 儲存資料
====================================================== */
async function loadUserDataFromServer() {
  if (!authState.token) throw new Error("No token");
  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: { Authorization: `Bearer ${authState.token}` },
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
        headers: { Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify(appData),
      });
    } catch (e) {
      console.warn("雲端同步失敗", e);
    }
  }, 500);
}

function saveData() {
  if (authState.mode === "guest") saveGuestData();
  else {
    saveUserCacheData();
    scheduleSaveDataToServer();
  }
}

/* ======================================================
   Task Rendering + Subtasks
====================================================== */
const taskListEl = document.getElementById("taskList");

function getSubtasksFor(task) {
  return Array.isArray(task.subtasks) ? task.subtasks : [];
}

function renderTaskList() {
  taskListEl.innerHTML = "";

  let filtered = appData.tasks.filter((t) => {
    if (currentFilter === "todo") return t.status !== "done";
    if (currentFilter === "done") return t.status === "done";
    return true;
  });

  filtered.forEach((t) => {
    const subtasks = getSubtasksFor(t);
    const doneCount = subtasks.filter((s) => s.done).length;

    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.category = t.category || "";
    li.dataset.taskId = t.id;
    if (t.status === "done") li.classList.add("done");

    const subtaskSummary =
      subtasks.length > 0 ? ` | 子任務：${doneCount} / ${subtasks.length}` : "";

    li.innerHTML = `
      <div class="task-main">
        <input type="checkbox" ${t.status === "done" ? "checked" : ""} />
        <span class="task-title">${t.title}</span>
      </div>

      <div class="task-meta">
        截止：${t.dueDate || "無"}　|　優先度：${t.priority}${subtaskSummary}
      </div>
      <div class="task-meta">分類：${t.category || "無"}</div>

      <div class="task-actions">
        <button class="btn-edit small">編輯</button>
        <button class="btn-bind small">綁定番茄鐘</button>
        <button class="btn-del small danger">刪除</button>
      </div>
    `;

    // Checkbox
    li.querySelector("input").addEventListener("change", (e) =>
      setTaskDone(t.id, e.target.checked)
    );

    // Edit
    li.querySelector(".btn-edit").addEventListener("click", () =>
      fillFormForEdit(t)
    );

    li.querySelector(".btn-bind").addEventListener("click", () => {
      currentTaskIdForPomodoro = t.id;
      updateCurrentTaskLabel();
      showToast("已綁定番茄鐘");
    });

    li.querySelector(".btn-del").addEventListener("click", () => {
      if (confirm("確定刪除任務？")) deleteTask(t.id);
    });

    taskListEl.appendChild(li);
  });

  renderTodayStats();
  renderWeeklyChart();
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

/* ======================================================
   Task Form (+ Subtasks Textarea)
====================================================== */
const taskIdEl = document.getElementById("taskId");
const taskTitleEl = document.getElementById("taskTitle");
const taskDescriptionEl = document.getElementById("taskDescription");
const taskDueDateEl = document.getElementById("taskDueDate");
const taskPriorityEl = document.getElementById("taskPriority");
const taskCategoryEl = document.getElementById("taskCategory");
const taskSubtasksEl = document.getElementById("taskSubtasks");

document.getElementById("taskForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const id = taskIdEl.value;
  const title = taskTitleEl.value.trim();
  if (!title) return showToast("請輸入標題");

  const lines = taskSubtasksEl.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const newSubtasks = lines.map((line) => ({
    id: createId("st"),
    title: line,
    done: false,
  }));

  const data = {
    title,
    description: taskDescriptionEl.value.trim(),
    dueDate: taskDueDateEl.value || "",
    priority: taskPriorityEl.value,
    category: taskCategoryEl.value,
    subtasks: newSubtasks,
  };

  if (id) updateTask(id, data);
  else addTask({ id: createId("t"), status: "todo", ...data });

  clearForm();
  showToast("任務已儲存");
});

function fillFormForEdit(t) {
  taskIdEl.value = t.id;
  taskTitleEl.value = t.title;
  taskDescriptionEl.value = t.description || "";
  taskDueDateEl.value = t.dueDate || "";
  taskPriorityEl.value = t.priority;
  taskCategoryEl.value = t.category || "";

  const subtasks = getSubtasksFor(t);
  taskSubtasksEl.value = subtasks.map((s) => s.title).join("\n");
}

function clearForm() {
  taskIdEl.value = "";
  taskTitleEl.value = "";
  taskDescriptionEl.value = "";
  taskDueDateEl.value = "";
  taskPriorityEl.value = "medium";
  taskCategoryEl.value = "";
  taskSubtasksEl.value = "";
}

document.getElementById("clearFormBtn").onclick = clearForm;

/* ======================================================
   今日統計 + 週完成度 Chart.js
====================================================== */
function renderTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const statEl = document.getElementById("todayStatsLabel");
  const stats = appData.dailyStats[today];

  if (!stats || stats.total === 0) statEl.textContent = "今日尚無任務記錄";
  else statEl.textContent = `完成 ${stats.done} / ${stats.total}`;
}

// 週完成度：最近 7 天，每天完成率（0~100）
function renderWeeklyChart() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas || !window.Chart) return;

  const ctx = canvas.getContext("2d");
  const labels = [];
  const data = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10); // YYYY-MM-DD
    labels.push(dateStr.slice(5)); // MM-DD

    const tasksOfDay = appData.tasks.filter((t) => t.dueDate === dateStr);
    const total = tasksOfDay.length;
    const done = tasksOfDay.filter((t) => t.status === "done").length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    data.push(pct);
  }

  if (weeklyChart) {
    weeklyChart.data.labels = labels;
    weeklyChart.data.datasets[0].data = data;
    weeklyChart.update();
  } else {
    weeklyChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "完成度 (%)",
            data,
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
          },
        },
      },
    });
  }
}

/* ======================================================
   番茄鐘
====================================================== */
const timerValueEl = document.getElementById("timerValue");
const timerModeLabelEl = document.getElementById("timerModeLabel");
const currentTaskLabelEl = document.getElementById("currentTaskLabel");

function updateCurrentTaskLabel() {
  if (!currentTaskIdForPomodoro) {
    currentTaskLabelEl.textContent = "尚未選擇任務";
    return;
  }
  const t = appData.tasks.find((x) => x.id === currentTaskIdForPomodoro);
  currentTaskLabelEl.textContent = t ? t.title : "任務已刪除";
}

function updateTimerDisplay() {
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  timerValueEl.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(
    2,
    "0"
  )}`;
  timerModeLabelEl.textContent =
    timerState.mode === "focus" ? "專注時間" : "休息時間";
}

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;

  timerState.timerId = setInterval(() => {
    timerState.remainingSeconds--;
    updateTimerDisplay();

    if (timerState.remainingSeconds <= 0) handleTimerFinished();
  }, 1000);
}

function pauseTimer() {
  timerState.running = false;
  clearInterval(timerState.timerId);
  timerState.timerId = null;
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
    finishedAt: new Date().toISOString(),
  });
  saveData();

  if (timerState.mode === "focus") {
    timerState.mode = "break";
    timerState.remainingSeconds = appData.settings.breakMinutes * 60;
    showToast("專注結束！休息一下");
  } else {
    timerState.mode = "focus";
    timerState.remainingSeconds = appData.settings.focusMinutes * 60;
    showToast("休息結束！繼續加油！");
  }

  updateTimerDisplay();
}

document.getElementById("startTimerBtn").onclick = startTimer;
document.getElementById("pauseTimerBtn").onclick = pauseTimer;
document.getElementById("resetTimerBtn").onclick = resetTimer;

document.getElementById("saveSettingsBtn").onclick = () => {
  const f = Number(document.getElementById("focusMinutesInput").value);
  const b = Number(document.getElementById("breakMinutesInput").value);

  if (f <= 0 || b <= 0) return showToast("分鐘必須大於 0");

  appData.settings.focusMinutes = f;
  appData.settings.breakMinutes = b;
  saveData();

  resetTimer();
  showToast("設定已更新");
};

/* ======================================================
   匯入 / 匯出
====================================================== */
document.getElementById("exportJsonBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "timeManagerData.json";
  a.click();

  URL.revokeObjectURL(url);
};

document.getElementById("importJsonInput").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      appData = { ...appData, ...parsed };
      saveData();
      afterDataLoaded();
      showToast("匯入成功");
    } catch {
      showToast("匯入失敗：格式錯誤");
    }
  };
  reader.readAsText(file);
};

/* ======================================================
   Login / Register Modal
====================================================== */
const authStatusLabelEl = document.getElementById("authStatusLabel");
const authActionBtnEl = document.getElementById("authActionBtn");

const authModalEl = document.getElementById("authModal");
const authModalTitleEl = document.getElementById("authModalTitle");
const authNameGroupEl = document.getElementById("authNameGroup");
const authNameInputEl = document.getElementById("authNameInput");
const authEmailInputEl = document.getElementById("authEmailInput");
const authPasswordInputEl = document.getElementById("authPasswordInput");
const authSubmitBtnEl = document.getElementById("authSubmitBtn");
const authCancelBtnEl = document.getElementById("authCancelBtn");
const authToggleBtnEl = document.getElementById("authToggleBtn");
const authToggleLabelEl = document.getElementById("authToggleLabel");

let authModalMode = "login";

function openAuthModal(mode = "login") {
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
    authToggleLabelEl.textContent = "已有帳號？";
    authToggleBtnEl.textContent = "登入";
  }

  authNameInputEl.value = "";
  authEmailInputEl.value = "";
  authPasswordInputEl.value = "";

  authModalEl.classList.remove("hidden");
}

function closeAuthModal() {
  authModalEl.classList.add("hidden");
}

authCancelBtnEl.onclick = closeAuthModal;

authToggleBtnEl.onclick = () =>
  openAuthModal(authModalMode === "login" ? "register" : "login");

/* --- API --- */
async function login(email, password) {
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

async function register(name, email, password) {
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

  // 初次註冊 → 上傳本機資料
  await apiRequest("/data/full", {
    method: "POST",
    headers: { Authorization: `Bearer ${authState.token}` },
    body: JSON.stringify(appData),
  });

  await loadUserDataFromServer();
}

/* --- 前端按鈕 --- */
authSubmitBtnEl.onclick = async () => {
  const name = authNameInputEl.value.trim();
  const email = authEmailInputEl.value.trim();
  const password = authPasswordInputEl.value;

  if (!email || !password || (authModalMode === "register" && !name))
    return showToast("請填寫完整資訊");

  try {
    if (authModalMode === "login") {
      await login(email, password);
      showToast("登入成功");
    } else {
      await register(name, email, password);
      showToast("註冊成功");
    }

    closeAuthModal();
    afterDataLoaded();
    updateAuthUI();
  } catch (err) {
    showToast("登入 / 註冊失敗：" + err.message);
  }
};

/* --- Header 按鈕（登入 / 登出） --- */
authActionBtnEl.onclick = () => {
  if (authState.mode === "user") {
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    showToast("已登出");
  } else openAuthModal("login");
};

/* ======================================================
   Settings Drawer（右側滑出）
====================================================== */
const settingsDrawerEl = document.getElementById("settingsDrawer");
const openSettingsBtn = document.getElementById("openSettingsBtn");
const closeSettingsBtn = document.getElementById("closeSettingsBtn");

const settingsUserEmailEl = document.getElementById("settingsUserEmail");
const settingsUserNameEl = document.getElementById("settingsUserName");

openSettingsBtn.onclick = () => {
  if (authState.mode === "guest") return showToast("登入後才能使用設定");
  settingsUserEmailEl.textContent = authState.user.email;
  settingsUserNameEl.textContent = authState.user.name;
  settingsDrawerEl.classList.add("open");
};

closeSettingsBtn.onclick = () => {
  settingsDrawerEl.classList.remove("open");
};

/* ======================================================
   修改名稱 / 修改密碼 / 刪除帳號
====================================================== */
document.getElementById("changeNameBtn").onclick = async () => {
  const newName = prompt("輸入新名稱：");
  if (!newName) return;

  try {
    const data = await apiRequest("/auth/change-name", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ name: newName }),
    });

    authState.user = data.user;
    saveAuthState();
    settingsUserNameEl.textContent = newName;
    updateAuthUI();
    showToast("名稱已更新");
  } catch (err) {
    showToast("更新失敗：" + err.message);
  }
};

document.getElementById("changePasswordBtn").onclick = async () => {
  const newPassword = document.getElementById("newPasswordInput").value;
  if (!newPassword) return showToast("請輸入新密碼");

  try {
    await apiRequest("/auth/change-password", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ newPassword }),
    });

    showToast("密碼已更新");
    document.getElementById("newPasswordInput").value = "";
  } catch (err) {
    showToast("更新失敗：" + err.message);
  }
};

document.getElementById("deleteAccountBtn").onclick = async () => {
  if (!confirm("確定要永久刪除帳號？所有資料將無法恢復！"))
    return;

  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` },
    });

    showToast("帳號已刪除");
    authState = { mode: "guest", user: null, token: null };
    saveAuthState();
    loadGuestData();
    afterDataLoaded();
    updateAuthUI();
    settingsDrawerEl.classList.remove("open");
  } catch (err) {
    showToast("刪除失敗：" + err.message);
  }
};

/* ======================================================
   UI 初始化
====================================================== */
function updateAuthUI() {
  if (authState.mode === "user") {
  settingsUserEmailEl.textContent = authState.user.email;
  settingsUserNameEl.textContent = authState.user.name;
  }
  else {
  settingsUserEmailEl.textContent = "";
  settingsUserNameEl.textContent = "";
  }
}

async function initApp() {
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch {
      loadUserCacheData();
    }
  } else {
    loadGuestData();
  }

  afterDataLoaded();
  updateAuthUI();
}

function afterDataLoaded() {
  document.getElementById("focusMinutesInput").value =
    appData.settings.focusMinutes;
  document.getElementById("breakMinutesInput").value =
    appData.settings.breakMinutes;

  timerState.mode = "focus";
  timerState.remainingSeconds = appData.settings.focusMinutes * 60;
  updateTimerDisplay();

  renderTaskList();
  updateCurrentTaskLabel();
}

initApp();
