const LS_GUEST_KEY = "timeManager_guest_v2";
const LS_USER_CACHE_KEY = "timeManager_user_cache_v2";
const LS_AUTH_KEY = "timeManager_auth_v2";
const DEFAULT_API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:3000"
  : "https://big-plan.onrender.com";
const API_BASE = localStorage.getItem("timeManager_api_base") || DEFAULT_API_BASE;

let authState = { mode: "guest", user: null, token: null };
let currentTaskIdForPomodoro = null;
let chartInstance = null;
let isLoginMode = true;
let sortable = null;
let saveDataDebounceTimer = null;

let appData = getEmptyData();

const timerState = {
  mode: "focus",
  remainingSeconds: 25 * 60,
  running: false,
  timerId: null
};

function getEmptyData() {
  return {
    tasks: [],
    pomodoroHistory: [],
    settings: { focusMinutes: 25, breakMinutes: 5 },
    dailyStats: {},
    learningProgress: { subjects: [] }
  };
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
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(String).map((t) => t.trim()).filter(Boolean);
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeTask(task) {
  return {
    id: task.id || createId("t"),
    title: task.title || "未命名任務",
    description: task.description || "",
    dueDate: task.dueDate || "",
    priority: task.priority || "medium",
    category: task.category || "",
    status: task.status || "todo",
    tags: normalizeTags(task.tags),
    estimateMinutes: Number(task.estimateMinutes ?? task.estimate ?? 25) || 0,
    actualMinutes: Number(task.actualMinutes) || 0,
    subtasks: Array.isArray(task.subtasks)
      ? task.subtasks.map((st) => ({
          id: st.id || createId("st"),
          title: st.title || "",
          status: st.status || "todo"
        }))
      : [],
    createdAt: task.createdAt || new Date().toISOString(),
    completedAt: task.completedAt || ""
  };
}

function normalizeSubject(subject) {
  return {
    id: subject.id || createId("s"),
    name: subject.name || "未命名主題",
    targetMinutes: Number(subject.targetMinutes) || 300,
    studiedMinutes: Number(subject.studiedMinutes) || 0,
    currentUnit: subject.currentUnit || "",
    nextReviewDate: subject.nextReviewDate || "",
    note: subject.note || "",
    createdAt: subject.createdAt || new Date().toISOString()
  };
}

function normalizeAppData(data) {
  const normalized = data || {};
  const empty = getEmptyData();
  return {
    tasks: Array.isArray(normalized.tasks) ? normalized.tasks.map(normalizeTask) : [],
    pomodoroHistory: Array.isArray(normalized.pomodoroHistory) ? normalized.pomodoroHistory : [],
    settings: {
      focusMinutes: Number(normalized.settings?.focusMinutes) || empty.settings.focusMinutes,
      breakMinutes: Number(normalized.settings?.breakMinutes) || empty.settings.breakMinutes
    },
    dailyStats: normalized.dailyStats && typeof normalized.dailyStats === "object" ? normalized.dailyStats : {},
    learningProgress: {
      subjects: Array.isArray(normalized.learningProgress?.subjects)
        ? normalized.learningProgress.subjects.map(normalizeSubject)
        : []
    }
  };
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function showToast(message) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
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
  if (authState.mode === "user") {
    localStorage.setItem(LS_USER_CACHE_KEY, JSON.stringify(appData));
    scheduleSaveDataToServer();
  } else {
    localStorage.setItem(LS_GUEST_KEY, JSON.stringify(appData));
  }
}

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
    } catch (err) {
      showToast(`雲端同步失敗：${err.message}`);
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
}

function isTodayTask(task) {
  return !task.dueDate || task.dueDate === todayKey();
}

function isOverdue(task) {
  return task.status !== "done" && task.dueDate && task.dueDate < todayKey();
}

function priorityRank(task) {
  return { high: 3, medium: 2, low: 1 }[task.priority] || 1;
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
    return true;
  });
}

function renderTaskList() {
  const list = $("taskList");
  if (!list) return;
  list.innerHTML = "";

  const tasks = getFilteredTasks();
  if (!tasks.length) {
    list.innerHTML = `<li class="empty-state">這裡目前沒有任務。</li>`;
    initSortable();
    return;
  }

  tasks.forEach((task) => {
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
        <span class="badge ${task.priority}">${priorityText(task.priority)}</span>
      </div>
      <p class="task-description">${escapeHtml(task.description || "沒有描述")}</p>
      <div class="task-meta">
        <span>${task.dueDate || "無截止日"}</span>
        <span>${statusText(task.status)}</span>
        <span>${categoryText(task.category)}</span>
        <span>${task.actualMinutes} / ${task.estimateMinutes} 分</span>
        <span>${subDone} / ${task.subtasks.length} 子任務</span>
      </div>
      <div class="tag-row">${tagHtml}</div>
      <div class="subtask-container"></div>
      <input class="subtask-input" placeholder="+ 新增子任務後按 Enter" />
      <div class="task-actions">
        <button class="small edit-btn secondary">編輯</button>
        <button class="small focus-btn">設為焦點</button>
        <button class="small done-btn secondary">${task.status === "done" ? "重開" : "完成"}</button>
        <button class="small danger delete-btn">刪除</button>
      </div>
    `;

    li.querySelector("input[type='checkbox']").onchange = (event) => {
      setTaskStatus(task.id, event.target.checked ? "done" : "todo");
    };
    li.querySelector(".edit-btn").onclick = () => fillTaskForm(task);
    li.querySelector(".focus-btn").onclick = () => setFocusTask(task.id);
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

function priorityText(priority) {
  return { low: "低", medium: "中", high: "高" }[priority] || "中";
}

function statusText(status) {
  return { todo: "待辦", doing: "進行中", done: "完成", deferred: "延後" }[status] || "待辦";
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

function setTaskStatus(taskId, status) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.status = status;
  task.completedAt = status === "done" ? new Date().toISOString() : "";
  saveData();
  renderAll();
}

function setFocusTask(taskId) {
  currentTaskIdForPomodoro = taskId;
  const task = appData.tasks.find((item) => item.id === taskId);
  if (task && task.status === "todo") task.status = "doing";
  saveData();
  renderAll();
  showToast(`已設為焦點：${task?.title || "任務"}`);
}

function deleteTask(taskId) {
  const task = appData.tasks.find((item) => item.id === taskId);
  if (!task || !confirm(`確定刪除「${task.title}」？`)) return;
  appData.tasks = appData.tasks.filter((item) => item.id !== taskId);
  if (currentTaskIdForPomodoro === taskId) currentTaskIdForPomodoro = null;
  saveData();
  renderAll();
}

function fillTaskForm(task) {
  $("taskId").value = task.id;
  $("taskTitle").value = task.title;
  $("taskDescription").value = task.description;
  $("taskDueDate").value = task.dueDate;
  $("taskStatus").value = task.status;
  $("taskPriority").value = task.priority;
  $("taskCategory").value = task.category;
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
    tags: normalizeTags($("taskTags").value),
    estimateMinutes: Number($("taskEstimate").value) || 0
  };

  if (id) {
    const task = appData.tasks.find((item) => item.id === id);
    if (task) Object.assign(task, payload, { completedAt: payload.status === "done" ? task.completedAt || new Date().toISOString() : "" });
    showToast("任務已更新");
  } else {
    appData.tasks.push(normalizeTask({ ...payload, id: createId("t"), createdAt: new Date().toISOString() }));
    showToast("任務已新增");
  }

  saveData();
  clearTaskForm();
  renderAll();
}

function pickTopTask() {
  const candidates = appData.tasks
    .filter((task) => task.status !== "done" && task.status !== "deferred")
    .sort((a, b) => {
      if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
      if (isTodayTask(a) !== isTodayTask(b)) return isTodayTask(a) ? -1 : 1;
      if (priorityRank(a) !== priorityRank(b)) return priorityRank(b) - priorityRank(a);
      return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999"));
    });
  if (!candidates.length) return showToast("目前沒有可挑選的任務");
  setFocusTask(candidates[0].id);
}

function renderFocusTask() {
  const card = $("focusTaskCard");
  if (!card) return;
  const task = appData.tasks.find((item) => item.id === currentTaskIdForPomodoro);
  if (!task) {
    card.className = "focus-card empty";
    card.innerHTML = `<p>還沒有焦點任務</p>`;
    return;
  }
  card.className = "focus-card";
  card.innerHTML = `
    <div>
      <span class="status-pill">${statusText(task.status)}</span>
      ${isOverdue(task) ? `<span class="status-pill danger-soft">已逾期</span>` : ""}
    </div>
    <h3>${escapeHtml(task.title)}</h3>
    <p>${escapeHtml(task.description || "先完成一個小步驟就好。")}</p>
    <div class="task-meta">
      <span>${task.dueDate || "無截止日"}</span>
      <span>${task.actualMinutes} / ${task.estimateMinutes} 分</span>
      <span>${categoryText(task.category)}</span>
    </div>
  `;
}

function updateCurrentTaskLabel() {
  const task = appData.tasks.find((item) => item.id === currentTaskIdForPomodoro);
  $("currentTaskLabel").textContent = task ? `目前專注：${task.title}` : "尚未選擇任務";
}

function updateTimerDisplay() {
  const minutes = Math.floor(timerState.remainingSeconds / 60);
  const seconds = timerState.remainingSeconds % 60;
  $("timerValue").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  $("timerModeLabel").textContent = timerState.mode === "focus" ? "專注" : "休息";
}

function applySettingsToTimer() {
  $("focusMinutesInput").value = appData.settings.focusMinutes;
  $("breakMinutesInput").value = appData.settings.breakMinutes;
  if (!timerState.running) {
    timerState.remainingSeconds = (timerState.mode === "focus" ? appData.settings.focusMinutes : appData.settings.breakMinutes) * 60;
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
  timerState.running = false;
  clearInterval(timerState.timerId);
  timerState.timerId = null;
}

function resetTimer() {
  pauseTimer();
  timerState.remainingSeconds = (timerState.mode === "focus" ? appData.settings.focusMinutes : appData.settings.breakMinutes) * 60;
  updateTimerDisplay();
}

function completeTimerRound() {
  const duration = timerState.mode === "focus" ? appData.settings.focusMinutes : appData.settings.breakMinutes;
  const task = appData.tasks.find((item) => item.id === currentTaskIdForPomodoro);
  appData.pomodoroHistory.push({
    id: createId("p"),
    taskId: task?.id || null,
    taskTitle: task?.title || "",
    mode: timerState.mode,
    duration,
    finishedAt: new Date().toISOString()
  });
  if (timerState.mode === "focus" && task) task.actualMinutes += duration;

  timerState.mode = timerState.mode === "focus" ? "break" : "focus";
  pauseTimer();
  timerState.remainingSeconds = (timerState.mode === "focus" ? appData.settings.focusMinutes : appData.settings.breakMinutes) * 60;
  saveData();
  renderAll();
  showToast(timerState.mode === "focus" ? "休息結束，準備下一輪專注" : "專注完成，該休息一下");
}

function savePomodoroSettings() {
  const focus = Number($("focusMinutesInput").value);
  const breakMinutes = Number($("breakMinutesInput").value);
  if (focus < 1 || breakMinutes < 1) return alert("分鐘數必須大於 0");
  appData.settings.focusMinutes = focus;
  appData.settings.breakMinutes = breakMinutes;
  saveData();
  applySettingsToTimer();
  showToast("番茄鐘設定已套用");
}

function getTodayStats() {
  const today = todayKey();
  const todayTasks = appData.tasks.filter((task) => task.dueDate === today || (!task.dueDate && task.status !== "done"));
  const todayDone = todayTasks.filter((task) => task.status === "done").length;
  const focusMinutes = appData.pomodoroHistory
    .filter((item) => item.mode === "focus" && item.finishedAt?.slice(0, 10) === today)
    .reduce((sum, item) => sum + Number(item.duration || 0), 0);
  return { todayTasks, todayDone, focusMinutes };
}

function getWeekDates() {
  return Array.from({ length: 7 }, (_, index) => addDays(todayKey(), index - 6));
}

function computeLearningStreak() {
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const date = addDays(todayKey(), -i);
    const minutes = appData.pomodoroHistory
      .filter((item) => item.mode === "focus" && item.finishedAt?.slice(0, 10) === date)
      .reduce((sum, item) => sum + Number(item.duration || 0), 0);
    if (minutes <= 0) break;
    streak += 1;
  }
  return streak;
}

function renderMetrics() {
  const { todayTasks, todayDone, focusMinutes } = getTodayStats();
  $("metricTodayTasks").textContent = `${todayDone} / ${todayTasks.length}`;
  $("metricFocusMinutes").textContent = `${focusMinutes} 分`;
  $("metricStreak").textContent = `${computeLearningStreak()} 天`;
  const weekDone = appData.tasks.filter((task) => task.completedAt && getWeekDates().includes(task.completedAt.slice(0, 10))).length;
  $("metricWeekDone").textContent = `${weekDone} 件`;
}

function renderStats() {
  renderMetrics();
  renderWeeklyChart();
  renderCategoryStats();
  renderPomodoroHistory();
}

function renderWeeklyChart() {
  const canvas = $("weeklyChart");
  if (!canvas || !window.Chart) return;

  const labels = getWeekDates().map((date) => date.slice(5));
  const doneValues = getWeekDates().map((date) => appData.tasks.filter((task) => task.completedAt?.slice(0, 10) === date).length);
  const focusValues = getWeekDates().map((date) =>
    appData.pomodoroHistory
      .filter((item) => item.mode === "focus" && item.finishedAt?.slice(0, 10) === date)
      .reduce((sum, item) => sum + Number(item.duration || 0), 0)
  );

  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "完成任務", data: doneValues, backgroundColor: "#4dabf7" },
        { label: "專注分鐘", data: focusValues, backgroundColor: "#51cf66" }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#d8dee9" } } },
      scales: {
        x: { ticks: { color: "#aeb7c3" }, grid: { color: "rgba(255,255,255,.08)" } },
        y: { beginAtZero: true, ticks: { color: "#aeb7c3", precision: 0 }, grid: { color: "rgba(255,255,255,.08)" } }
      }
    }
  });
}

function renderCategoryStats() {
  const wrap = $("categoryStats");
  if (!wrap) return;
  const totals = new Map();
  appData.tasks.forEach((task) => {
    const label = categoryText(task.category);
    totals.set(label, (totals.get(label) || 0) + Number(task.actualMinutes || 0));
  });
  wrap.innerHTML = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, minutes]) => `<div><span>${escapeHtml(name)}</span><strong>${minutes} 分</strong></div>`)
    .join("") || `<p class="empty-state">還沒有分類時間紀錄。</p>`;
}

function renderPomodoroHistory() {
  const list = $("pomodoroHistoryList");
  if (!list) return;
  const recent = [...appData.pomodoroHistory].reverse().slice(0, 6);
  list.innerHTML = recent
    .map((item) => `<li>${item.finishedAt?.slice(0, 10) || ""} · ${item.mode === "focus" ? "專注" : "休息"} · ${item.duration} 分 ${item.taskTitle ? `· ${escapeHtml(item.taskTitle)}` : ""}</li>`)
    .join("") || `<li class="empty-state">還沒有番茄鐘紀錄。</li>`;
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
    list.innerHTML = `<li class="empty-state">新增一個學習計畫，讓進度開始累積。</li>`;
    return;
  }

  list.innerHTML = "";
  subjects.forEach((subject) => {
    const item = document.createElement("li");
    const subjectPercent = Math.min(100, Math.round((subject.studiedMinutes / subject.targetMinutes) * 100));
    const reviewDue = subject.nextReviewDate && subject.nextReviewDate <= todayKey();
    item.className = `learning-item ${reviewDue ? "review-due" : ""}`;
    item.innerHTML = `
      <div class="learning-head">
        <strong>${escapeHtml(subject.name)}</strong>
        <span>${subject.studiedMinutes} / ${subject.targetMinutes} 分</span>
      </div>
      <div class="progress-track small-track"><div class="progress-bar" style="width:${subjectPercent}%"></div></div>
      <p>${escapeHtml(subject.currentUnit || "尚未設定目前單元")}</p>
      <p class="task-meta">${reviewDue ? "今天需要複習" : `下次複習：${subject.nextReviewDate || "未設定"}`}</p>
      <p class="note">${escapeHtml(subject.note || "")}</p>
      <div class="learning-actions">
        <button class="small add25">+25 分</button>
        <button class="small secondary add5">+5 分</button>
        <button class="small secondary review">完成複習</button>
        <button class="small danger remove">刪除</button>
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
    note: $("subjectNoteInput").value.trim()
  }));

  $("learningForm").reset();
  $("subjectTargetInput").value = "300";
  saveData();
  renderAll();
}

function addStudyMinutes(subjectId, minutes) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject) return;
  subject.studiedMinutes += minutes;
  if (!subject.nextReviewDate) subject.nextReviewDate = addDays(todayKey(), 1);
  saveData();
  renderAll();
}

function completeReview(subjectId) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject) return;
  const current = subject.nextReviewDate || todayKey();
  subject.nextReviewDate = addDays(current, subject.studiedMinutes > 120 ? 7 : 3);
  saveData();
  renderAll();
  showToast("已排入下一次複習");
}

function removeSubject(subjectId) {
  const subject = appData.learningProgress.subjects.find((item) => item.id === subjectId);
  if (!subject || !confirm(`確定刪除「${subject.name}」？`)) return;
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
  $("dailyReflectionInput").value = appData.dailyStats[todayKey()]?.reflection || "";
}

function exportJson() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `personal-learning-manager-${todayKey()}.json`;
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
      showToast("JSON 已匯入");
    } catch (_) {
      alert("JSON 格式錯誤，無法匯入。");
    }
  };
  reader.readAsText(file);
}

function updateAuthUI() {
  $("authStatusLabel").textContent = authState.mode === "user"
    ? `${authState.user?.name || "使用者"}，已登入`
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
}

async function handleAuthSubmit() {
  const email = $("authEmailInput").value.trim();
  const password = $("authPasswordInput").value;
  const name = $("authNameInput").value.trim();
  if (!email || !password || (!isLoginMode && !name)) return alert("請填寫必要欄位。");
  if (password.length < 8) return alert("密碼至少需要 8 個字元。");

  const endpoint = isLoginMode ? "/auth/login" : "/auth/register";
  const payload = isLoginMode ? { email, password } : { email, password, name };
  const guestTasks = authState.mode === "guest" ? [...appData.tasks] : [];

  try {
    const res = await apiRequest(endpoint, { method: "POST", body: JSON.stringify(payload) });
    authState = { mode: "user", token: res.token, user: res.user };
    saveAuthState();
    await loadUserDataFromServer();
    if (guestTasks.length) {
      const existing = new Set(appData.tasks.map((task) => task.id));
      appData.tasks = [...appData.tasks, ...guestTasks.filter((task) => !existing.has(task.id))];
      saveData();
    }
    $("authModal").classList.add("hidden");
    updateAuthUI();
    renderAll();
    showToast("已登入並同步資料");
  } catch (err) {
    alert(`登入失敗：${err.message}`);
  }
}

function logout() {
  if (!confirm("確定要登出？Guest 資料會保留在此瀏覽器。")) return;
  authState = { mode: "guest", user: null, token: null };
  saveAuthState();
  appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_GUEST_KEY) || "{}"));
  updateAuthUI();
  applySettingsToTimer();
  renderAll();
}

function renderSettingsUserInfo() {
  $("settingsUserEmail").textContent = authState.user?.email || "-";
  $("settingsUserName").textContent = authState.user?.name || "-";
}

async function handleChangeName() {
  if (authState.mode !== "user") return alert("請先登入。");
  const name = prompt("請輸入新的姓名", authState.user?.name || "");
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
    showToast("姓名已更新");
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
  if (!confirm("確定刪除帳號？雲端資料會一併刪除。")) return;
  try {
    await apiRequest("/auth/delete", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authState.token}` }
    });
    localStorage.removeItem(LS_AUTH_KEY);
    localStorage.removeItem(LS_USER_CACHE_KEY);
    authState = { mode: "guest", user: null, token: null };
    updateAuthUI();
    showToast("帳號已刪除");
  } catch (err) {
    alert(`刪除失敗：${err.message}`);
  }
}

function renderAll() {
  appData = normalizeAppData(appData);
  renderTaskList();
  renderFocusTask();
  updateCurrentTaskLabel();
  updateTimerDisplay();
  renderLearning();
  renderStats();
  loadReflection();
}

function bindEvents() {
  $("taskForm").onsubmit = handleTaskSubmit;
  $("clearFormBtn").onclick = clearTaskForm;
  $("taskFilter").onchange = renderTaskList;
  $("selectTopTaskBtn").onclick = pickTopTask;
  $("saveReflectionBtn").onclick = saveReflection;

  $("startTimerBtn").onclick = startTimer;
  $("pauseTimerBtn").onclick = pauseTimer;
  $("resetTimerBtn").onclick = resetTimer;
  $("saveSettingsBtn").onclick = savePomodoroSettings;

  $("learningForm").onsubmit = addSubject;
  $("exportJsonBtn").onclick = exportJson;
  $("importJsonInput").onchange = (event) => importJson(event.target.files?.[0]);

  $("authActionBtn").onclick = () => authState.mode === "user" ? logout() : openAuthModal(true);
  $("authCancelBtn").onclick = () => $("authModal").classList.add("hidden");
  $("authToggleBtn").onclick = () => openAuthModal(!isLoginMode);
  $("authSubmitBtn").onclick = handleAuthSubmit;

  $("openSettingsBtn").onclick = () => $("settingsDrawer").classList.add("open");
  $("closeSettingsBtn").onclick = () => $("settingsDrawer").classList.remove("open");
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
    }
  } catch (_) {
    appData = normalizeAppData(JSON.parse(localStorage.getItem(LS_USER_CACHE_KEY) || "{}"));
  }

  currentTaskIdForPomodoro = appData.tasks.find((task) => task.status === "doing")?.id || null;
  updateAuthUI();
  applySettingsToTimer();
  renderAll();
}

window.addEventListener("load", init);
