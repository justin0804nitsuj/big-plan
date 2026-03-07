/* ======================================================
   Local Storage Keys & API Base
====================================================== */
const LS_GUEST_KEY = "timeManager_guest_v1";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v1";
const LS_AUTH_KEY = "timeManager_auth_v1";
const API_BASE = "https://big-plan.onrender.com";

/* ======================================================
   Global State (全域狀態)
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
let myChart = null; 

let timerState = {
  mode: "focus",
  remainingSeconds: 25 * 60,
  running: false,
  timerId: null,
};

let sortableInitialized = false;

/* ======================================================
   Utils (工具函數)
====================================================== */
function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

/* ======================================================
   API & Auth Logic
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
  return res.status === 204 ? null : res.json();
}

function loadAuthState() {
  const raw = localStorage.getItem(LS_AUTH_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.mode === "guest" || parsed.mode === "user")) {
        authState = parsed;
      }
    } catch (e) { console.error("Auth state parse failed", e); }
  }
}

function saveAuthState() {
  localStorage.setItem(LS_AUTH_KEY, JSON.stringify(authState));
}

/* ======================================================
   Data Sync Logic (資料同步與合併)
====================================================== */
function saveData() {
  if (authState.mode === "guest") {
    localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
  } else {
    localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
    scheduleSaveDataToServer();
  }
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
    } catch (err) {
      console.warn("Sync failed", err);
      showToast("雲端同步失敗（稍後重試）");
    }
  }, 1000);
}

async function loadUserDataFromServer() {
  if (!authState.token) return;
  const data = await apiRequest("/data/full", {
    method: "GET",
    headers: { Authorization: `Bearer ${authState.token}` },
  });
  // 確保結構完整
  appData = { 
    ...appData, 
    ...data, 
    tasks: data.tasks || [], 
    dailyStats: data.dailyStats || {} 
  };
  localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
}

/* ======================================================
   UI Rendering (任務與圖表)
====================================================== */
function renderTaskList() {
  const listEl = document.getElementById("taskList");
  if (!listEl) return;
  listEl.innerHTML = "";

  const filteredTasks = appData.tasks.filter((t) => {
    if (currentFilter === "todo") return t.status !== "done";
    if (currentFilter === "done") return t.status === "done";
    return true;
  });

  filteredTasks.forEach((task) => {
    const li = document.createElement("li");
    li.className = `task-item ${task.status === "done" ? "done" : ""}`;
    li.dataset.taskId = task.id;

    // 主任務內容
    const main = document.createElement("div");
    main.className = "task-main";
    main.innerHTML = `
      <input type="checkbox" ${task.status === "done" ? "checked" : ""} />
      <span class="task-title">${task.title}</span>
      <span class="badge ${task.priority}">${task.priority}</span>
    `;

    main.querySelector("input").onchange = (e) => {
      task.status = e.target.checked ? "done" : "todo";
      updateDailyStatsOnTaskChange();
      saveData();
      renderTaskList();
    };

    // 子任務區域
    const subContainer = document.createElement("div");
    subContainer.className = "subtask-container";
    (task.subtasks || []).forEach((st, idx) => {
      const stDiv = document.createElement("div");
      stDiv.className = "subtask-item";
      stDiv.innerHTML = `
        <input type="checkbox" ${st.status === 'done' ? 'checked' : ''}>
        <span class="${st.status === 'done' ? 'st-done' : ''}">${st.title}</span>
      `;
      stDiv.querySelector("input").onchange = (e) => {
        task.subtasks[idx].status = e.target.checked ? 'done' : 'todo';
        saveData();
        renderTaskList();
      };
      subContainer.appendChild(stDiv);
    });

    const addStInput = document.createElement("input");
    addStInput.className = "subtask-input";
    addStInput.placeholder = "+ 子任務 (Enter 新增)";
    addStInput.onkeydown = (e) => {
      if (e.key === 'Enter' && addStInput.value.trim()) {
        if (!task.subtasks) task.subtasks = [];
        task.subtasks.push({ title: addStInput.value.trim(), status: 'todo' });
        saveData();
        renderTaskList();
      }
    };

    // 按鈕區
    const actions = document.createElement("div");
    actions.className = "task-actions";
    actions.innerHTML = `<button class="small focus-btn">專注</button>
                         <button class="danger small">刪除</button>`;
    
    actions.querySelector(".focus-btn").onclick = () => {
      currentTaskIdForPomodoro = task.id;
      updateCurrentTaskLabel();
      showToast(`已綁定：${task.title}`);
    };

    actions.querySelector(".danger").onclick = () => {
      if(confirm("確定刪除？")) {
        appData.tasks = appData.tasks.filter(t => t.id !== task.id);
        saveData();
        renderTaskList();
      }
    };

    li.appendChild(main);
    li.appendChild(subContainer);
    li.appendChild(addStInput);
    li.appendChild(actions);
    listEl.appendChild(li);
  });
  renderTodayStats();
}

function updateDailyStatsOnTaskChange() {
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = appData.tasks.filter(t => t.dueDate === today || !t.dueDate);
  appData.dailyStats[today] = {
    done: todayTasks.filter(t => t.status === "done").length,
    total: todayTasks.length
  };
}

function renderWeeklyChart() {
  const canvas = document.getElementById("weeklyChart");
  if (!canvas || !window.Chart) return;
  const ctx = canvas.getContext("2d");

  const labels = [];
  const counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    labels.push(dateStr.slice(5)); 
    counts.push(appData.dailyStats[dateStr]?.done || 0);
  }

  if (myChart) myChart.destroy();
  myChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: '完成數', data: counts, backgroundColor: '#4dabf7' }]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

function renderTodayStats() {
  const today = new Date().toISOString().slice(0, 10);
  const stats = appData.dailyStats[today] || { done: 0, total: 0 };
  const label = document.getElementById("todayStatsLabel");
  if (label) label.textContent = `今日進度：${stats.done} / ${stats.total}`;
  renderWeeklyChart();
}

/* ======================================================
   Auth Handlers (登入與合併邏輯)
====================================================== */
async function handleAuthSubmit() {
  const isLogin = document.getElementById("authModalTitle").textContent === "登入";
  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPasswordInput").value;
  const name = document.getElementById("authNameInput").value.trim();

  const endpoint = isLogin ? "/auth/login" : "/auth/register";
  const body = isLogin ? { email, password } : { email, password, name };

  try {
    const data = await apiRequest(endpoint, { method: "POST", body: JSON.stringify(body) });
    
    // 備份 Guest 資料
    const guestTasks = [...appData.tasks];
    
    authState = { mode: "user", token: data.token, user: data.user };
    saveAuthState();

    await loadUserDataFromServer();

    // 合併資料
    if (guestTasks.length > 0) {
      const serverIds = new Set(appData.tasks.map(t => t.id));
      const uniqueTasks = guestTasks.filter(t => !serverIds.has(t.id));
      appData.tasks = [...appData.tasks, ...uniqueTasks];
      saveData();
      showToast(`已同步 ${uniqueTasks.length} 個任務至帳號`);
    }

    document.getElementById("authModal").classList.add("hidden");
    afterDataLoaded();
    updateAuthUI();
  } catch (err) {
    alert("驗證失敗：" + err.message);
  }
}

/* ======================================================
   Pomodoro & Timer
====================================================== */
function updateTimerDisplay() {
  const m = Math.floor(timerState.remainingSeconds / 60);
  const s = timerState.remainingSeconds % 60;
  document.getElementById("timerValue").textContent = 
    `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function updateCurrentTaskLabel() {
  const label = document.getElementById("currentTaskLabel");
  const task = appData.tasks.find(t => t.id === currentTaskIdForPomodoro);
  label.textContent = task ? task.title : "尚未選擇任務";
}

// 事件綁定 (僅列出核心)
document.getElementById("authSubmitBtn").onclick = handleAuthSubmit;
document.getElementById("authActionBtn").onclick = () => {
  if (authState.mode === "user") {
    if(confirm("確定登出？")) {
      authState = { mode: "guest", user: null, token: null };
      saveAuthState();
      location.reload(); 
    }
  } else {
    document.getElementById("authModal").classList.remove("hidden");
  }
};

/* ======================================================
   Initialization
====================================================== */
function afterDataLoaded() {
  renderTaskList();
  updateAuthUI();
  updateTimerDisplay();
}

function updateAuthUI() {
  const label = document.getElementById("authStatusLabel");
  const btn = document.getElementById("authActionBtn");
  if (authState.mode === "user") {
    label.textContent = `${authState.user.name} (已登入)`;
    btn.textContent = "登出";
  } else {
    label.textContent = "Guest 模式";
    btn.textContent = "登入 / 註冊";
  }
}

async function initApp() {
  loadAuthState();
  if (authState.mode === "user" && authState.token) {
    try { await loadUserDataFromServer(); } catch(e) {
      const cache = localStorage.getItem(LS_USER_CACHE_KEY);
      if (cache) appData = JSON.parse(cache);
    }
  } else {
    const guest = localStorage.getItem(LS_GUEST_KEY);
    if (guest) appData = JSON.parse(guest);
  }
  afterDataLoaded();
}

window.onload = initApp;