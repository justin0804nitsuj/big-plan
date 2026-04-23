const LS_GUEST_KEY = "timeManager_guest_v1";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v1";
const LS_AUTH_KEY = "timeManager_auth_v1";
const API_BASE = "https://big-plan.onrender.com";

let authState = { mode: "guest", user: null, token: null };
let currentFilter = "all";
let currentTaskIdForPomodoro = null;
let chartInstance = null;
let isLoginMode = true;
let sortable = null;

let appData = {
  tasks: [],
  pomodoroHistory: [],
  settings: { focusMinutes: 25, breakMinutes: 5 },
  dailyStats: {},
  learningProgress: { subjects: [] }
};

const timerState = {
  mode: "focus",
  remainingSeconds: 25 * 60,
  running: false,
  timerId: null
};

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function normalizeAppData(data) {
  const normalized = data || {};
  return {
    tasks: Array.isArray(normalized.tasks) ? normalized.tasks : [],
    pomodoroHistory: Array.isArray(normalized.pomodoroHistory) ? normalized.pomodoroHistory : [],
    settings: {
      focusMinutes: Number(normalized.settings?.focusMinutes) || 25,
      breakMinutes: Number(normalized.settings?.breakMinutes) || 5
    },
    dailyStats: normalized.dailyStats || {},
    learningProgress: {
      subjects: Array.isArray(normalized.learningProgress?.subjects) ? normalized.learningProgress.subjects : []
    }
  };
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2800);
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
    if (parsed?.mode === "user" && parsed?.token) {
      authState = parsed;
    }
  } catch (_) {}
}

function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

function saveData() {
  if (authState.mode === "user") {
    localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
    scheduleSaveDataToServer();
  } else {
    localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
  }
}

let saveDataDebounceTimer = null;
function scheduleSaveDataToServer() {
  if (!authState.token) return;
  if (saveDataDebounceTimer) clearTimeout(saveDataDebounceTimer);
  saveDataDebounceTimer = setTimeout(async () => {
    try {
      await apiRequest("/data/full", {
        method: "POST",
        headers: { Authorization: `Bearer ${authState.token}` },
        body: JSON.stringify(appData)
      });
    } catch (_) {
      showToast("雲端同步失敗，稍後重試");
    }
  }, 800);
}

async function loadUserDataFromServer() {
  if (!authState.token) return;
  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: { Authorization: `Bearer ${authState.token}` }
  });
  appData = normalizeAppData(data);
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
}

function renderTaskList() {
  const listEl = document.getElementById("taskList");
  if (!listEl) return;
  listEl.innerHTML = "";

  const filtered = appData.tasks.filter((task) => {
    if (currentFilter === "todo") return task.status !== "done";
    if (currentFilter === "done") return task.status === "done";
    return true;
  });

  filtered.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.status === "done" ? "done" : ""}`;
    li.dataset.taskId = task.id;
    li.dataset.category = task.category || "";
    li.innerHTML = `
      <div class="task-main">
        <input type="checkbox" ${task.status === "done" ? "checked" : ""} />
        <span class="task-title">${escapeHtml(task.title || "未命名任務")}</span>
        <span class="badge ${task.priority || "medium"}">${task.priority || "medium"}</span>
      </div>
      <div class="task-meta">
        截止：${task.dueDate || "無"} / 分類：${task.category || "未分類"}
      </div>
    `;

    const check = li.querySelector("input[type='checkbox']");
    check.onchange = () => {
      task.status = check.checked ? "done" : "todo";
      updateDailyStatsOnTaskChange();
      saveData();
      renderAll();
    };

    const subtaskContainer = document.createElement("div");
    subtaskContainer.className = "subtask-container";
    const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
    subtasks.forEach((st, idx) => {
      const row = document.createElement("div");
      row.className = "subtask-item";
      row.innerHTML = `
        <input type="checkbox" ${st.status === "done" ? "checked" : ""} />
        <span class="${st.status === "done" ? "st-done" : ""}">${escapeHtml(st.title || "")}</span>
      `;
      row.querySelector("input").onchange = (e) => {
        task.subtasks[idx].status = e.target.checked ? "done" : "todo";
        saveData();
        renderTaskList();
      };
      subtaskContainer.appendChild(row);
    });

    const subtaskInput = document.createElement("input");
    subtaskInput.className = "subtask-input";
    subtaskInput.placeholder = "+ 子任務（Enter 新增）";
    subtaskInput.onkeydown = (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const title = subtaskInput.value.trim();
      if (!title) return;
      if (!Array.isArray(task.subtasks)) task.subtasks = [];
      task.subtasks.push({ title, status: "todo" });
      subtaskInput.value = "";
      saveData();
      renderTaskList();
    };

    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.innerHTML = `
      <button class="small edit-btn secondary">編輯</button>
      <button class="small focus-btn">專注</button>
      <button class="small danger delete-btn">刪除</button>
    `;
    actions.querySelector(".edit-btn").onclick = () => fillTaskForm(task);
    actions.querySelector(".focus-btn").onclick = () => {
      currentTaskIdForPomodoro = task.id;
      updateCurrentTaskLabel();
      showToast(`已綁定任務：${task.title}`);
    };
    actions.querySelector(".delete-btn").onclick = () => {
      if (!confirm("確定刪除此任務？")) return;
      appData.tasks = appData.tasks.filter((t) => t.id !== task.id);
      updateDailyStatsOnTaskChange();
      saveData();
      renderAll();
    };

    li.appendChild(subtaskContainer);
    li.appendChild(subtaskInput);
    li.appendChild(actions);
    listEl.appendChild(li);
  });

  initSortable();
}

function initSortable() {
  if (!window.Sortable) return;
  const el = document.getElementById("taskList");
  if (!el) return;
  if (sortable) sortable.destroy();
  sortable = new Sortable(el, {
    animation: 150,
    onEnd: () => {
      const ids = Array.from(el.querySelectorAll(".task-item")).map((item) => item.dataset.taskId);
      const map = new Map(appData.tasks.map((t) => [t.id, t]));
      const reordered = ids.map((id) => map.get(id)).filter(Boolean);
      if (currentFilter === "all") appData.tasks = reordered;
      saveData();
    }
  });
}

function fillTaskForm(task) {
  document.getElementById("taskId").value = task.id;
  document.getElementById("taskTitle").value = task.title || "";
  document.getElementById("taskDescription").value = task.description || "";
  document.getElementById("taskDueDate").value = task.dueDate || "";
  document.getElementById("taskPriority").value = task.priority || "medium";
  document.getElementById("taskCategory").value = task.category || "";
}

function clearTaskForm() {
  document.getElementById("taskId").value = "";
  document.getElementById("taskTitle").value = "";
  document.getElementById("taskDescription").value = "";
  document.getElementById("taskDueDate").value = "";
  document.getElementById("taskPriority").value = "medium";
  document.getElementById("taskCategory").value = "";
}

function onTaskSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("taskId").value.trim();
  const title = document.getElementById("taskTitle").value.trim();
  const description = document.getElementById("taskDescription").value.trim();
  const dueDate = document.getElementById("taskDueDate").value;
  const priority = document.getElementById("taskPriority").value;
  const category = document.getElementById("taskCategory").value;
  if (!title) return;

  if (id) {
    const task = appData.tasks.find((t) => t.id === id);
    if (task) {
      task.title = title;
      task.description = description;
      task.dueDate = dueDate;
      task.priority = priority;
      task.category = category;
    }
    showToast("任務已更新");
  } else {
    appData.tasks.push({
      id: createId("t"),
      title,
      description,
      dueDate,
      priority,
      category,
      status: "todo",
      subtasks: []
    });
    showToast("任務已新增");
  }

  updateDailyStatsOnTaskChange();
  saveData();
  clearTaskForm();
  renderAll();
}

function updateDailyStatsOnTaskChange() {
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = appData.tasks.filter((task) => !task.dueDate || task.dueDate === today);
  appData.dailyStats[today] = {
    done: todayTasks.filter((task) => task.status === "done").length,
    total: todayTasks.length
  };
}

function renderTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const todayStats = appData.dailyStats[today] || { done: 0, total: 0 };
  const label = document.getElementById("todayStatsLabel");
  if (label) label.textContent = `今日進度：${todayStats.done} / ${todayStats.total}`;
}

function renderWeeklyChart() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas || !window.Chart) return;

  const labels = [];
  const values = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    labels.push(date.slice(5));
    values.push(appData.dailyStats[date]?.done || 0);
  }

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [{ label: "每日完成任務", data: values, backgroundColor: "#4dabf7" }]
    },
    options: {
      plugins: { legend: { labels: { color: "#e5e5e5" } } },
      scales: {
        x: { ticks: { color: "#bbb" }, grid: { color: "#303030" } },
        y: { beginAtZero: true, ticks: { color: "#bbb", precision: 0 }, grid: { color: "#303030" } }
      }
    }
  });
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  document.getElementById("timerValue").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  document.getElementById("timerModeLabel").textContent = timerState.mode === "focus" ? "專注時間" : "休息時間";
}

function applySettingsToTimer() {
  const focus = Number(appData.settings.focusMinutes) || 25;
  const breakM = Number(appData.settings.breakMinutes) || 5;
  document.getElementById("focusMinutesInput").value = focus;
  document.getElementById("breakMinutesInput").value = breakM;
  if (!timerState.running) {
    timerState.remainingSeconds = (timerState.mode === "focus" ? focus : breakM) * 60;
    updateTimerDisplay();
  }
}

function startTimer() {
  if (timerState.running) return;
  timerState.running = true;
  timerState.timerId = setInterval(() => {
    timerState.remainingSeconds -= 1;
    if (timerState.remainingSeconds <= 0) {
      completeTimerRound();
      return;
    }
    updateTimerDisplay();
  }, 1000);
}

function pauseTimer() {
  if (!timerState.running) return;
  timerState.running = false;
  clearInterval(timerState.timerId);
  timerState.timerId = null;
}

function resetTimer() {
  pauseTimer();
  const minutes = timerState.mode === "focus" ? Number(appData.settings.focusMinutes) : Number(appData.settings.breakMinutes);
  timerState.remainingSeconds = (minutes || 25) * 60;
  updateTimerDisplay();
}

function completeTimerRound() {
  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  const duration = timerState.mode === "focus" ? Number(appData.settings.focusMinutes) : Number(appData.settings.breakMinutes);
  appData.pomodoroHistory.push({
    id: createId("p"),
    taskId: task?.id || null,
    mode: timerState.mode,
    duration,
    finishedAt: new Date().toISOString()
  });

  timerState.mode = timerState.mode === "focus" ? "break" : "focus";
  pauseTimer();
  const nextMinutes = timerState.mode === "focus" ? Number(appData.settings.focusMinutes) : Number(appData.settings.breakMinutes);
  timerState.remainingSeconds = (nextMinutes || 25) * 60;
  updateTimerDisplay();
  saveData();
  showToast(timerState.mode === "focus" ? "休息結束，回到專注時間" : "專注結束，休息一下");
}

function updateCurrentTaskLabel() {
  const task = appData.tasks.find((t) => t.id === currentTaskIdForPomodoro);
  document.getElementById("currentTaskLabel").textContent = task?.title || "尚未選擇任務";
}

function updateAuthUI() {
  const label = document.getElementById("authStatusLabel");
  const actionBtn = document.getElementById("authActionBtn");
  if (authState.mode === "user") {
    label.textContent = `${authState.user?.name || "使用者"}（已登入）`;
    actionBtn.textContent = "登出";
  } else {
    label.textContent = "Guest 模式";
    actionBtn.textContent = "登入 / 註冊";
  }
  renderSettingsUserInfo();
}

function openAuthModal(loginMode) {
  isLoginMode = loginMode;
  document.getElementById("authModal").classList.remove("hidden");
  document.getElementById("authModalTitle").textContent = loginMode ? "登入" : "註冊";
  document.getElementById("authSubmitBtn").textContent = loginMode ? "登入" : "建立帳號";
  document.getElementById("authNameGroup").style.display = loginMode ? "none" : "block";
  document.getElementById("authToggleLabel").textContent = loginMode ? "還沒有帳號？" : "已經有帳號？";
  document.getElementById("authToggleBtn").textContent = loginMode ? "建立帳號" : "改為登入";
}

async function handleAuthSubmit() {
  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPasswordInput").value;
  const name = document.getElementById("authNameInput").value.trim();
  if (!email || !password || (!isLoginMode && !name)) {
    alert("請填寫完整欄位");
    return;
  }

  const endpoint = isLoginMode ? "/auth/login" : "/auth/register";
  const payload = isLoginMode ? { email, password } : { email, password, name };
  const guestTasks = [...appData.tasks];

  try {
    const res = await apiRequest(endpoint, { method: "POST", body: JSON.stringify(payload) });
    authState = { mode: "user", token: res.token, user: res.user };
    saveAuthState();
    await loadUserDataFromServer();

    if (guestTasks.length) {
      const existing = new Set(appData.tasks.map((task) => task.id));
      const merged = guestTasks.filter((task) => !existing.has(task.id));
      appData.tasks = [...appData.tasks, ...merged];
      updateDailyStatsOnTaskChange();
      saveData();
    }

    document.getElementById("authModal").classList.add("hidden");
    updateAuthUI();
    renderAll();
    showToast("登入成功，已載入雲端資料");
  } catch (err) {
    alert(`驗證失敗：${err.message}`);
  }
}

function logout() {
  if (!confirm("確定要登出？")) return;
  authState = { mode: "guest", user: null, token: null };
  saveAuthState();
  location.reload();
}

function renderSettingsUserInfo() {
  document.getElementById("settingsUserEmail").textContent = authState.user?.email || "-";
  document.getElementById("settingsUserName").textContent = authState.user?.name || "-";
}

async function handleChangeName() {
  if (authState.mode !== "user") return alert("請先登入");
  const name = prompt("請輸入新名稱", authState.user?.name || "");
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
    alert(`更新名稱失敗：${err.message}`);
  }
}

async function handleChangePassword() {
  if (authState.mode !== "user") return alert("請先登入");
  const password = document.getElementById("newPasswordInput").value.trim();
  if (!password) return alert("請輸入新密碼");
  try {
    await apiRequest("/auth/update-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${authState.token}` },
      body: JSON.stringify({ password })
    });
    document.getElementById("newPasswordInput").value = "";
    showToast("密碼已更新");
  } catch (err) {
    alert(`更新密碼失敗：${err.message}`);
  }
}

async function handleDeleteAccount() {
  if (authState.mode !== "user") return alert("請先登入");
  if (!confirm("此操作無法復原，確定刪除帳號？")) return;
  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    localStorage.removeItem(LS_AUTH_KEY);
    localStorage.removeItem(LS_USER_CACHE_KEY);
    authState = { mode: "guest", user: null, token: null };
    showToast("帳號已刪除");
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `time-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result || "{}"));
      appData = normalizeAppData(parsed);
      updateDailyStatsOnTaskChange();
      saveData();
      renderAll();
      showToast("匯入成功");
    } catch (_) {
      alert("JSON 格式錯誤，無法匯入");
    }
  };
  reader.readAsText(file);
}

function renderLearning() {
  const list = document.getElementById("learningList");
  const summary = document.getElementById("learningSummaryLabel");
  const bar = document.getElementById("learningProgressBar");
  if (!list || !summary || !bar) return;

  const subjects = appData.learningProgress.subjects;
  list.innerHTML = "";

  if (!subjects.length) {
    summary.textContent = "尚未建立學習科目";
    bar.style.width = "0%";
    return;
  }

  let totalTarget = 0;
  let totalStudied = 0;
  subjects.forEach((subject) => {
    totalTarget += Number(subject.targetMinutes || 0);
    totalStudied += Number(subject.studiedMinutes || 0);
  });
  const percent = totalTarget > 0 ? Math.min(100, Math.round((totalStudied / totalTarget) * 100)) : 0;
  summary.textContent = `總學習進度：${totalStudied} / ${totalTarget} 分鐘（${percent}%）`;
  bar.style.width = `${percent}%`;

  subjects.forEach((subject) => {
    const item = document.createElement("li");
    item.className = "learning-item";
    const subjectPercent = subject.targetMinutes > 0
      ? Math.min(100, Math.round((subject.studiedMinutes / subject.targetMinutes) * 100))
      : 0;

    item.innerHTML = `
      <div class="learning-head">
        <strong>${escapeHtml(subject.name)}</strong>
        <span>${subject.studiedMinutes} / ${subject.targetMinutes} 分</span>
      </div>
      <div class="task-meta">完成度 ${subjectPercent}%</div>
      <div class="learning-actions">
        <button class="small add25">+25 分</button>
        <button class="small secondary add5">+5 分</button>
        <button class="small danger remove">刪除</button>
      </div>
    `;

    item.querySelector(".add25").onclick = () => addStudyMinutes(subject.id, 25);
    item.querySelector(".add5").onclick = () => addStudyMinutes(subject.id, 5);
    item.querySelector(".remove").onclick = () => removeSubject(subject.id);
    list.appendChild(item);
  });
}

function addSubject(e) {
  e.preventDefault();
  const nameInput = document.getElementById("subjectNameInput");
  const targetInput = document.getElementById("subjectTargetInput");
  const name = nameInput.value.trim();
  const targetMinutes = Number(targetInput.value);
  if (!name || targetMinutes <= 0) return;

  appData.learningProgress.subjects.push({
    id: createId("s"),
    name,
    targetMinutes,
    studiedMinutes: 0
  });

  nameInput.value = "";
  targetInput.value = "300";
  saveData();
  renderLearning();
}

function addStudyMinutes(subjectId, minutes) {
  const subject = appData.learningProgress.subjects.find((s) => s.id === subjectId);
  if (!subject) return;
  subject.studiedMinutes += minutes;
  saveData();
  renderLearning();
}

function removeSubject(subjectId) {
  if (!confirm("確定刪除此科目？")) return;
  appData.learningProgress.subjects = appData.learningProgress.subjects.filter((s) => s.id !== subjectId);
  saveData();
  renderLearning();
}

function renderAll() {
  renderTaskList();
  updateCurrentTaskLabel();
  renderTodayStats();
  renderWeeklyChart();
  renderLearning();
}

function savePomodoroSettings() {
  const focus = Number(document.getElementById("focusMinutesInput").value);
  const breakM = Number(document.getElementById("breakMinutesInput").value);
  if (focus < 1 || breakM < 1) {
    alert("分鐘必須大於 0");
    return;
  }
  appData.settings.focusMinutes = focus;
  appData.settings.breakMinutes = breakM;
  saveData();
  applySettingsToTimer();
  showToast("番茄鐘設定已儲存");
}

function bindEvents() {
  document.getElementById("taskForm").onsubmit = onTaskSubmit;
  document.getElementById("clearFormBtn").onclick = clearTaskForm;
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.onclick = () => {
      currentFilter = btn.dataset.filter || "all";
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderTaskList();
    };
  });

  document.getElementById("startTimerBtn").onclick = startTimer;
  document.getElementById("pauseTimerBtn").onclick = pauseTimer;
  document.getElementById("resetTimerBtn").onclick = resetTimer;
  document.getElementById("saveSettingsBtn").onclick = savePomodoroSettings;

  document.getElementById("exportJsonBtn").onclick = exportJson;
  document.getElementById("importJsonInput").onchange = (e) => importJson(e.target.files?.[0]);

  document.getElementById("authActionBtn").onclick = () => {
    if (authState.mode === "user") logout();
    else openAuthModal(true);
  };
  document.getElementById("authCancelBtn").onclick = () => document.getElementById("authModal").classList.add("hidden");
  document.getElementById("authToggleBtn").onclick = () => openAuthModal(!isLoginMode);
  document.getElementById("authSubmitBtn").onclick = handleAuthSubmit;

  document.getElementById("openSettingsBtn").onclick = () => document.getElementById("settingsDrawer").classList.add("open");
  document.getElementById("closeSettingsBtn").onclick = () => document.getElementById("settingsDrawer").classList.remove("open");
  document.getElementById("changeNameBtn").onclick = handleChangeName;
  document.getElementById("changePasswordBtn").onclick = handleChangePassword;
  document.getElementById("deleteAccountBtn").onclick = handleDeleteAccount;

  document.getElementById("learningForm").onsubmit = addSubject;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function init() {
  bindEvents();
  loadAuthState();

  if (authState.mode === "user" && authState.token) {
    try {
      await loadUserDataFromServer();
    } catch (_) {
      const cache = localStorage.getItem(LS_USER_CACHE_KEY);
      appData = normalizeAppData(cache ? JSON.parse(cache) : {});
    }
  } else {
    const guest = localStorage.getItem(LS_GUEST_KEY);
    appData = normalizeAppData(guest ? JSON.parse(guest) : {});
  }

  updateAuthUI();
  applySettingsToTimer();
  updateTimerDisplay();
  renderAll();
  openAuthModal(true);
  document.getElementById("authModal").classList.add("hidden");
}

window.onload = init;
