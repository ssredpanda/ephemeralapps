const STORAGE_KEY = "monthlyclosing:v1";

const defaultState = {
  currentMonth: getCurrentMonth(),
  members: [
    { id: "m-yamada", name: "山田 太郎" },
    { id: "m-sato", name: "佐藤 花子" },
    { id: "m-suzuki", name: "鈴木 一郎" },
  ],
  tasks: [
    { id: "t-expense", name: "経費申請" },
    { id: "t-attendance", name: "勤怠締め" },
    { id: "t-report", name: "月報提出" },
    { id: "t-invoice", name: "請求確認" },
  ],
  assignments: {
    "m-yamada": ["t-expense", "t-attendance", "t-report"],
    "m-sato": ["t-attendance", "t-invoice"],
    "m-suzuki": ["t-expense", "t-attendance", "t-report"],
  },
  records: {},
};

const elements = {};
let state = normalizeState(loadState());
let activeView = "check";
let statusTimer = 0;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  renderAll();
});

function bindElements() {
  for (const id of [
    "monthLabel",
    "monthInput",
    "backupBtn",
    "restoreInput",
    "statusMessage",
    "checkList",
    "assignmentMatrix",
    "memberForm",
    "memberNameInput",
    "membersTable",
    "taskForm",
    "taskNameInput",
    "tasksTable",
  ]) {
    elements[id] = document.getElementById(id);
  }
}

function bindEvents() {
  elements.monthInput.addEventListener("change", () => {
    state.currentMonth = elements.monthInput.value || getCurrentMonth();
    saveAndRender();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view;
      renderAll();
    });
  });

  elements.memberForm.addEventListener("submit", addMember);
  elements.taskForm.addEventListener("submit", addTask);
  elements.backupBtn.addEventListener("click", backupData);
  elements.restoreInput.addEventListener("change", restoreData);
}

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizeState(value, fallback = defaultState) {
  const next = value && typeof value === "object" ? structuredClone(value) : structuredClone(fallback);
  next.currentMonth = /^\d{4}-\d{2}$/.test(next.currentMonth || "") ? next.currentMonth : getCurrentMonth();
  next.members = Array.isArray(next.members)
    ? next.members.filter((item) => item && item.id && item.name).map((item) => ({ id: item.id, name: item.name }))
    : [];
  next.tasks = Array.isArray(next.tasks)
    ? next.tasks.filter((item) => item && item.id && item.name).map((item) => ({ id: item.id, name: item.name }))
    : [];
  next.assignments = next.assignments && typeof next.assignments === "object" ? next.assignments : {};
  next.records = next.records && typeof next.records === "object" ? next.records : {};

  const memberIds = new Set(next.members.map((member) => member.id));
  const taskIds = new Set(next.tasks.map((task) => task.id));

  for (const memberId of Object.keys(next.assignments)) {
    if (!memberIds.has(memberId)) {
      delete next.assignments[memberId];
      continue;
    }
    next.assignments[memberId] = Array.isArray(next.assignments[memberId])
      ? unique(next.assignments[memberId].filter((taskId) => taskIds.has(taskId)))
      : [];
  }

  for (const member of next.members) {
    if (!Array.isArray(next.assignments[member.id])) {
      next.assignments[member.id] = [];
    }
  }

  for (const month of Object.keys(next.records)) {
    if (!/^\d{4}-\d{2}$/.test(month) || !next.records[month] || typeof next.records[month] !== "object") {
      delete next.records[month];
      continue;
    }

    for (const memberId of Object.keys(next.records[month])) {
      if (!memberIds.has(memberId) || !next.records[month][memberId] || typeof next.records[month][memberId] !== "object") {
        delete next.records[month][memberId];
        continue;
      }

      for (const taskId of Object.keys(next.records[month][memberId])) {
        const record = next.records[month][memberId][taskId];
        if (!taskIds.has(taskId) || !record || record.checked !== true) {
          delete next.records[month][memberId][taskId];
          continue;
        }
        next.records[month][memberId][taskId] = {
          checked: true,
          checkedAt: record.checkedAt || "",
        };
      }

      if (!Object.keys(next.records[month][memberId]).length) {
        delete next.records[month][memberId];
      }
    }

    if (!Object.keys(next.records[month]).length) {
      delete next.records[month];
    }
  }

  return next;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function saveAndRender(message) {
  saveState();
  renderAll();
  if (message) showStatus(message);
}

function renderAll() {
  const monthText = formatMonth(state.currentMonth);

  elements.monthInput.value = state.currentMonth;
  elements.monthLabel.textContent = `${monthText} の締め状況`;

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === activeView);
  });

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.remove("is-active");
  });
  document.getElementById(`${activeView}View`).classList.add("is-active");

  renderCheckView();
  renderAssignmentsView();
  renderMembersView();
  renderTasksView();
}

function renderCheckView() {
  if (!state.members.length || !state.tasks.length) {
    elements.checkList.replaceChildren(createEmptyState("メンバーとタスクを登録してください。"));
    return;
  }

  const rows = [];

  for (const member of state.members) {
    const summary = getMemberCheckSummary(member.id);
    rows.push({ member, summary });
  }

  if (!rows.length) {
    elements.checkList.replaceChildren(createEmptyState("表示できるメンバーがありません。"));
    return;
  }

  const table = createEl("table", "check-matrix-table");
  table.append(createCheckMatrixHead(state.tasks));
  const tbody = document.createElement("tbody");
  for (const row of rows) {
    tbody.append(createCheckMatrixRow(row.member, row.summary, state.tasks));
  }
  table.append(tbody);

  elements.checkList.replaceChildren(table);
}

function createCheckMatrixHead(tasks) {
  const thead = document.createElement("thead");
  const row = document.createElement("tr");
  row.append(createEl("th", "sticky-member-col", "メンバー"));
  row.append(createEl("th", "summary-col", "状況"));

  for (const task of tasks) {
    const th = createEl("th", "task-col");
    th.append(createEl("div", "task-name", task.name));
    row.append(th);
  }

  thead.append(row);
  return thead;
}

function createCheckMatrixRow(member, summary, tasks) {
  const row = document.createElement("tr");
  const memberCell = createEl("td", "sticky-member-col strong-cell", member.name);
  const summaryDone = summary.total > 0 && summary.done === summary.total;
  const summaryCell = createEl("td", "summary-col");
  summaryCell.append(createEl("span", `count-badge summary-badge${summaryDone ? " is-done" : " is-open"}`, `${summary.done}/${summary.total}`));
  row.append(memberCell, summaryCell);

  for (const task of tasks) {
    row.append(createCheckMatrixCell(member, task));
  }

  return row;
}

function createCheckMatrixCell(member, task) {
  const assigned = getAssignedTaskIds(member.id).includes(task.id);
  if (!assigned) return createEl("td", "check-matrix-cell is-unassigned", "-");

  const checked = isChecked(member.id, task.id);
  const record = getRecord(member.id, task.id);
  const cell = createEl("td", `check-matrix-cell${checked ? " is-done" : " is-open"}`);
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "check-checkbox";
  checkbox.checked = checked;
  checkbox.title = record?.checkedAt ? `確認日時 ${formatDateTime(record.checkedAt)}` : "未確認";
  checkbox.setAttribute("aria-label", `${member.name} ${task.name}`);
  checkbox.addEventListener("change", () => {
    setChecked(member.id, task.id, checkbox.checked);
    saveAndRender(`${member.name} / ${task.name} を${checkbox.checked ? "完了" : "未完了"}にしました。`);
  });
  cell.append(checkbox);
  return cell;
}

function renderAssignmentsView() {
  if (!state.members.length || !state.tasks.length) {
    elements.assignmentMatrix.replaceChildren(createEmptyState("メンバーとタスクを登録してください。"));
    return;
  }

  const table = createEl("table", "matrix-table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headerRow.append(createEl("th", "", "メンバー"));
  for (const task of state.tasks) {
    const th = createEl("th");
    th.append(createEl("div", "task-name", task.name));
    headerRow.append(th);
  }
  headerRow.append(createEl("th", "", "件数"));
  thead.append(headerRow);

  const tbody = document.createElement("tbody");
  for (const member of state.members) {
    const tr = document.createElement("tr");
    const memberCell = createEl("td");
    memberCell.append(createEl("div", "task-name", member.name));
    tr.append(memberCell);

    for (const task of state.tasks) {
      const td = createEl("td", "matrix-cell");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "matrix-checkbox";
      checkbox.checked = getAssignedTaskIds(member.id).includes(task.id);
      checkbox.setAttribute("aria-label", `${member.name} に ${task.name} を割り当て`);
      checkbox.addEventListener("change", () => {
        setAssignment(member.id, task.id, checkbox.checked);
        saveAndRender(`${member.name} の割り当てを更新しました。`);
      });
      td.append(checkbox);
      tr.append(td);
    }

    tr.append(createEl("td", "", String(getAssignedTaskIds(member.id).length)));
    tbody.append(tr);
  }

  table.append(thead, tbody);
  elements.assignmentMatrix.replaceChildren(table);
}

function renderMembersView() {
  if (!state.members.length) {
    elements.membersTable.replaceChildren(createEmptyState("メンバーが未登録です。"));
    return;
  }

  const table = createEl("table");
  table.append(createTableHead(["氏名", "割り当て", "操作"]));
  const tbody = document.createElement("tbody");

  for (const member of state.members) {
    const tr = document.createElement("tr");
    tr.append(createEditableCell(member.name, "氏名", (value) => updateMember(member.id, { name: value })));
    const countCell = createEl("td");
    countCell.append(createEl("span", "count-badge", String(getAssignedTaskIds(member.id).length)));
    tr.append(countCell);
    tr.append(createActionCell(() => deleteMember(member.id)));
    tbody.append(tr);
  }

  table.append(tbody);
  elements.membersTable.replaceChildren(table);
}

function renderTasksView() {
  if (!state.tasks.length) {
    elements.tasksTable.replaceChildren(createEmptyState("タスクが未登録です。"));
    return;
  }

  const table = createEl("table");
  table.append(createTableHead(["タスク名", "割り当て", "操作"]));
  const tbody = document.createElement("tbody");

  for (const task of state.tasks) {
    const tr = document.createElement("tr");
    tr.append(createEditableCell(task.name, "タスク名", (value) => updateTask(task.id, { name: value })));
    const assignedCount = state.members.filter((member) => getAssignedTaskIds(member.id).includes(task.id)).length;
    const countCell = createEl("td");
    countCell.append(createEl("span", "count-badge", String(assignedCount)));
    tr.append(countCell);
    tr.append(createActionCell(() => deleteTask(task.id)));
    tbody.append(tr);
  }

  table.append(tbody);
  elements.tasksTable.replaceChildren(table);
}

function createEditableCell(value, label, onCommit) {
  const td = createEl("td");
  const input = document.createElement("input");
  input.className = "editable-input";
  input.value = value;
  input.placeholder = label;
  input.addEventListener("change", () => onCommit(input.value.trim()));
  td.append(input);
  return td;
}

function createActionCell(onDelete) {
  const td = createEl("td");
  const wrap = createEl("div", "row-actions");
  const button = createEl("button", "text-button is-danger", "削除");
  button.type = "button";
  button.addEventListener("click", onDelete);
  wrap.append(button);
  td.append(wrap);
  return td;
}

function createTableHead(labels) {
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const label of labels) {
    tr.append(createEl("th", "", label));
  }
  thead.append(tr);
  return thead;
}

function addMember(event) {
  event.preventDefault();
  const name = elements.memberNameInput.value.trim();
  if (!name) return;

  const member = { id: createId("m"), name };
  state.members.push(member);
  state.assignments[member.id] = [];
  elements.memberForm.reset();
  saveAndRender(`${name} を追加しました。`);
}

function addTask(event) {
  event.preventDefault();
  const name = elements.taskNameInput.value.trim();
  if (!name) return;

  state.tasks.push({ id: createId("t"), name });
  elements.taskForm.reset();
  saveAndRender(`${name} を追加しました。`);
}

function updateMember(memberId, values) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;
  if ("name" in values && !values.name) {
    renderMembersView();
    return;
  }
  Object.assign(member, values);
  saveAndRender("メンバーを更新しました。");
}

function updateTask(taskId, values) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if ("name" in values && !values.name) {
    renderTasksView();
    return;
  }
  Object.assign(task, values);
  saveAndRender("タスクを更新しました。");
}

function deleteMember(memberId) {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return;
  if (!window.confirm(`${member.name} を削除しますか？`)) return;

  state.members = state.members.filter((item) => item.id !== memberId);
  delete state.assignments[memberId];
  for (const month of Object.keys(state.records)) {
    delete state.records[month][memberId];
  }
  saveAndRender(`${member.name} を削除しました。`);
}

function deleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) return;
  if (!window.confirm(`${task.name} を削除しますか？`)) return;

  state.tasks = state.tasks.filter((item) => item.id !== taskId);
  for (const memberId of Object.keys(state.assignments)) {
    state.assignments[memberId] = getAssignedTaskIds(memberId).filter((id) => id !== taskId);
  }
  for (const month of Object.keys(state.records)) {
    for (const memberId of Object.keys(state.records[month])) {
      delete state.records[month][memberId][taskId];
    }
  }
  saveAndRender(`${task.name} を削除しました。`);
}

function backupData() {
  const csv = createBackupCsv(state);
  const blob = new Blob([`\ufeff${csv}\r\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `monthlyclosing-backup-${state.currentMonth}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showStatus("CSVバックアップを書き出しました。");
}

function restoreData(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = parseBackupCsv(String(reader.result));
      if (!window.confirm("現在のデータをバックアップCSVの内容で置き換えますか？")) return;
      state = imported;
      saveAndRender("CSVバックアップからリストアしました。");
    } catch {
      showStatus("CSVバックアップを読み込めませんでした。", "danger");
    }
  });
  reader.readAsText(file);
}

function createBackupCsv(source) {
  const rows = [["type", "current_month", "member_id", "member_name", "task_id", "task_name", "month", "checked", "checked_at"]];
  rows.push(["meta", source.currentMonth, "", "", "", "", "", "", ""]);

  for (const member of source.members) {
    rows.push(["member", "", member.id, member.name, "", "", "", "", ""]);
  }

  for (const task of source.tasks) {
    rows.push(["task", "", "", "", task.id, task.name, "", "", ""]);
  }

  for (const member of source.members) {
    const assignedTaskIds = Array.isArray(source.assignments[member.id]) ? source.assignments[member.id] : [];
    for (const taskId of assignedTaskIds) {
      rows.push(["assignment", "", member.id, "", taskId, "", "", "", ""]);
    }
  }

  for (const month of Object.keys(source.records).sort()) {
    for (const memberId of Object.keys(source.records[month]).sort()) {
      for (const taskId of Object.keys(source.records[month][memberId]).sort()) {
        const record = source.records[month][memberId][taskId];
        if (record?.checked) {
          rows.push(["record", "", memberId, "", taskId, "", month, "1", record.checkedAt || ""]);
        }
      }
    }
  }

  return rows.map((row) => row.map(toCsvValue).join(",")).join("\r\n");
}

function parseBackupCsv(text) {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim() !== ""));
  const header = rows.shift();
  if (!header || header[0] !== "type" || header[1] !== "current_month") {
    throw new Error("Invalid backup CSV");
  }

  const restored = {
    currentMonth: getCurrentMonth(),
    members: [],
    tasks: [],
    assignments: {},
    records: {},
  };
  const memberIds = new Set();
  const taskIds = new Set();

  for (const row of rows) {
    const [type, currentMonth, memberId, memberName, taskId, taskName, month, checked, checkedAt] = row;

    if (type === "meta" && /^\d{4}-\d{2}$/.test(currentMonth || "")) {
      restored.currentMonth = currentMonth;
      continue;
    }

    if (type === "member" && memberId && memberName && !memberIds.has(memberId)) {
      restored.members.push({ id: memberId, name: memberName });
      restored.assignments[memberId] = restored.assignments[memberId] || [];
      memberIds.add(memberId);
      continue;
    }

    if (type === "task" && taskId && taskName && !taskIds.has(taskId)) {
      restored.tasks.push({ id: taskId, name: taskName });
      taskIds.add(taskId);
      continue;
    }

    if (type === "assignment" && memberId && taskId) {
      restored.assignments[memberId] = restored.assignments[memberId] || [];
      restored.assignments[memberId].push(taskId);
      continue;
    }

    if (type === "record" && memberId && taskId && /^\d{4}-\d{2}$/.test(month || "") && checked === "1") {
      restored.records[month] = restored.records[month] || {};
      restored.records[month][memberId] = restored.records[month][memberId] || {};
      restored.records[month][memberId][taskId] = {
        checked: true,
        checkedAt: checkedAt || "",
      };
    }
  }

  return normalizeState(restored);
}

function parseCsv(text) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (inQuotes) throw new Error("Unclosed CSV quote");
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function toCsvValue(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function getMemberCheckSummary(memberId) {
  const assigned = getAssignedTaskIds(memberId);
  const done = assigned.filter((taskId) => isChecked(memberId, taskId)).length;
  return { total: assigned.length, done };
}

function getAssignedTaskIds(memberId) {
  return Array.isArray(state.assignments[memberId]) ? state.assignments[memberId] : [];
}

function setAssignment(memberId, taskId, enabled) {
  const current = new Set(getAssignedTaskIds(memberId));
  if (enabled) {
    current.add(taskId);
  } else {
    current.delete(taskId);
  }
  state.assignments[memberId] = state.tasks.filter((task) => current.has(task.id)).map((task) => task.id);
}

function getRecord(memberId, taskId) {
  return state.records[state.currentMonth]?.[memberId]?.[taskId] || null;
}

function isChecked(memberId, taskId) {
  return Boolean(getRecord(memberId, taskId)?.checked);
}

function setChecked(memberId, taskId, checked) {
  state.records[state.currentMonth] = state.records[state.currentMonth] || {};
  state.records[state.currentMonth][memberId] = state.records[state.currentMonth][memberId] || {};

  if (checked) {
    state.records[state.currentMonth][memberId][taskId] = {
      checked: true,
      checkedAt: new Date().toISOString(),
    };
    return;
  }

  delete state.records[state.currentMonth][memberId][taskId];
  if (!Object.keys(state.records[state.currentMonth][memberId]).length) {
    delete state.records[state.currentMonth][memberId];
  }
  if (!Object.keys(state.records[state.currentMonth]).length) {
    delete state.records[state.currentMonth];
  }
}

function showStatus(message, tone = "default") {
  window.clearTimeout(statusTimer);
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message is-visible${tone === "danger" ? " is-danger" : ""}`;
  statusTimer = window.setTimeout(() => {
    elements.statusMessage.textContent = "";
    elements.statusMessage.className = "status-message";
  }, 3000);
}

function createEmptyState(message) {
  return createEl("div", "empty-state", message);
}

function createEl(tagName, className = "", text = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function unique(values) {
  return Array.from(new Set(values));
}

function getCurrentMonth() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

function formatMonth(value) {
  const [year, month] = value.split("-");
  return `${year}年${Number(month)}月`;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
