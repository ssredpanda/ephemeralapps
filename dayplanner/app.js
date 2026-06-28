(() => {
  const STORAGE_KEY = 'dayplanner-state';
  const PX_PER_MIN = 3;
  const SNAP_MIN = 10;

  const dayStartInput = document.getElementById('dayStart');
  const dayEndInput = document.getElementById('dayEnd');
  const taskForm = document.getElementById('taskForm');
  const taskTitleInput = document.getElementById('taskTitle');
  const taskDurationInput = document.getElementById('taskDuration');
  const taskColorInput = document.getElementById('taskColor');
  const pool = document.getElementById('pool');
  const timeline = document.getElementById('timeline');

  const editDialog = document.getElementById('editDialog');
  const editForm = document.getElementById('editForm');
  const editTitle = document.getElementById('editTitle');
  const editDuration = document.getElementById('editDuration');
  const editColor = document.getElementById('editColor');
  const editDelete = document.getElementById('editDelete');
  const editCancel = document.getElementById('editCancel');

  let state = loadState();
  let editingTaskId = null;
  let activeDrag = null;

  const dragGhost = document.createElement('div');
  dragGhost.className = 'drag-ghost hidden';

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* ignore corrupt state */ }
    return { dayStart: '10:00', dayEnd: '19:00', tasks: [] };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function timeToMinutes(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  function minutesToTime(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function formatTaskLabel(task, startMin, endMin) {
    const timePart = startMin !== null && endMin !== null
      ? `${minutesToTime(startMin)}-${minutesToTime(endMin)}（${task.duration}分） `
      : `（${task.duration}分） `;
    return timePart + task.title;
  }

  function dayTotalMinutes() {
    return timeToMinutes(state.dayEnd) - timeToMinutes(state.dayStart);
  }

  function genId() {
    return 't' + Math.random().toString(36).slice(2, 10);
  }

  function render() {
    dayStartInput.value = state.dayStart;
    dayEndInput.value = state.dayEnd;
    renderPool();
    renderTimeline();
  }

  function renderPool() {
    pool.innerHTML = '';
    state.tasks.filter(t => t.start === null).forEach(task => {
      pool.appendChild(buildChip(task));
    });
  }

  function buildChip(task) {
    const chip = document.createElement('div');
    chip.className = 'task-chip';
    chip.tabIndex = 0;
    chip.dataset.id = task.id;
    chip.style.background = task.color;
    chip.innerHTML = `<span class="task-label">${escapeHtml(formatTaskLabel(task, null, null))}</span>`;
    chip.addEventListener('pointerdown', e => onPointerDown(e, task));
    chip.addEventListener('keydown', e => onItemKeyDown(e, task));
    return chip;
  }

  function renderTimeline() {
    timeline.innerHTML = '';
    const total = dayTotalMinutes();
    const height = Math.max(total * PX_PER_MIN, 60);
    timeline.style.height = height + 'px';

    const startMin = timeToMinutes(state.dayStart);
    const endMin = timeToMinutes(state.dayEnd);
    const firstGrid = Math.ceil(startMin / 10) * 10;
    for (let m = firstGrid; m <= endMin; m += 10) {
      const top = (m - startMin) * PX_PER_MIN;
      const isHour = m % 60 === 0;
      const isHalf = m % 30 === 0;
      const line = document.createElement('div');
      line.className = 'hour-line' + (isHour ? ' major' : isHalf ? ' half' : ' minor');
      line.style.top = top + 'px';
      timeline.appendChild(line);

      if (isHour) {
        const label = document.createElement('div');
        label.className = 'hour-label';
        label.style.top = top + 'px';
        label.textContent = minutesToTime(m);
        timeline.appendChild(label);
      }
    }

    timeline.appendChild(dragGhost);
    dragGhost.classList.add('hidden');

    state.tasks.filter(t => t.start !== null).forEach(task => {
      timeline.appendChild(buildBlock(task));
    });
  }

  function buildBlock(task) {
    const block = document.createElement('div');
    block.className = 'task-block';
    block.tabIndex = 0;
    block.dataset.id = task.id;
    block.style.background = task.color;
    block.style.top = (task.start * PX_PER_MIN) + 'px';
    block.style.height = Math.max(task.duration * PX_PER_MIN - 2, 18) + 'px';

    const startMin = timeToMinutes(state.dayStart) + task.start;
    const endMin = startMin + task.duration;
    block.innerHTML = `<span class="task-label">${escapeHtml(formatTaskLabel(task, startMin, endMin))}</span>`;

    block.addEventListener('pointerdown', e => onPointerDown(e, task));
    block.addEventListener('keydown', e => onItemKeyDown(e, task));
    return block;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Drag and drop (pointer events; works for mouse + touch) ---

  const DRAG_THRESHOLD = 4;

  function isInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function snappedStartFromY(clientY, timelineRect, task) {
    const y = clientY - timelineRect.top;
    let newStart = Math.round((y / PX_PER_MIN) / SNAP_MIN) * SNAP_MIN;
    const total = dayTotalMinutes();
    newStart = Math.max(0, Math.min(newStart, total - task.duration));
    if (total < task.duration) newStart = 0;
    return newStart;
  }

  function showGhost(newStart, task) {
    const startMin = timeToMinutes(state.dayStart) + newStart;
    const endMin = startMin + task.duration;
    dragGhost.style.top = (newStart * PX_PER_MIN) + 'px';
    dragGhost.style.height = (task.duration * PX_PER_MIN) + 'px';
    dragGhost.textContent = formatTaskLabel(task, startMin, endMin);
    dragGhost.classList.remove('hidden');
  }

  function onPointerDown(e, task) {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();

    const clone = el.cloneNode(true);
    clone.className = el.className + ' drag-clone';
    clone.style.position = 'fixed';
    clone.style.left = rect.left + 'px';
    clone.style.top = rect.top + 'px';
    clone.style.width = rect.width + 'px';
    clone.style.height = rect.height + 'px';
    clone.style.margin = '0';
    document.body.appendChild(clone);

    el.classList.add('dragging-source');

    activeDrag = {
      taskId: task.id,
      grabOffsetX: e.clientX - rect.left,
      grabOffsetY: e.clientY - rect.top,
      clone,
      sourceEl: el,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function onPointerMove(e) {
    if (!activeDrag) return;
    activeDrag.lastX = e.clientX;
    activeDrag.lastY = e.clientY;
    if (!activeDrag.moved) {
      const dx = e.clientX - activeDrag.startX;
      const dy = e.clientY - activeDrag.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) activeDrag.moved = true;
    }

    activeDrag.clone.style.left = (e.clientX - activeDrag.grabOffsetX) + 'px';
    activeDrag.clone.style.top = (e.clientY - activeDrag.grabOffsetY) + 'px';

    const task = state.tasks.find(t => t.id === activeDrag.taskId);
    if (!task) return;

    const timelineRect = timeline.getBoundingClientRect();
    const poolRect = pool.getBoundingClientRect();

    if (isInsideRect(e.clientX, e.clientY, timelineRect)) {
      pool.classList.remove('drag-over');
      timeline.classList.add('drag-over');
      showGhost(snappedStartFromY(e.clientY, timelineRect, task), task);
    } else if (isInsideRect(e.clientX, e.clientY, poolRect)) {
      timeline.classList.remove('drag-over');
      dragGhost.classList.add('hidden');
      pool.classList.add('drag-over');
    } else {
      timeline.classList.remove('drag-over');
      pool.classList.remove('drag-over');
      dragGhost.classList.add('hidden');
    }
  }

  function onPointerUp() {
    if (!activeDrag) return;
    const { taskId, clone, sourceEl, moved, lastX, lastY } = activeDrag;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    clone.remove();
    sourceEl.classList.remove('dragging-source');
    timeline.classList.remove('drag-over');
    pool.classList.remove('drag-over');
    dragGhost.classList.add('hidden');
    activeDrag = null;

    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    if (!moved) {
      openEdit(task.id);
      return;
    }

    const timelineRect = timeline.getBoundingClientRect();
    const poolRect = pool.getBoundingClientRect();

    if (isInsideRect(lastX, lastY, timelineRect)) {
      placeTask(task, snappedStartFromY(lastY, timelineRect, task));
      saveState();
      render();
    } else if (isInsideRect(lastX, lastY, poolRect)) {
      task.start = null;
      saveState();
      render();
    }
  }

  function onItemKeyDown(e, task) {
    if (task.start === null) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEdit(task.id);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openEdit(task.id);
      return;
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const total = dayTotalMinutes();
    const delta = e.key === 'ArrowUp' ? -SNAP_MIN : SNAP_MIN;
    const newStart = Math.max(0, Math.min(task.start + delta, total - task.duration));
    if (newStart === task.start) return;
    placeTask(task, newStart);
    saveState();
    render();
    const movedEl = timeline.querySelector(`[data-id="${task.id}"]`);
    if (movedEl) movedEl.focus();
  }

  function placeTask(task, newStart) {
    const newEnd = newStart + task.duration;
    const overlapping = state.tasks.filter(t =>
      t.id !== task.id &&
      t.start !== null &&
      newStart < t.start + t.duration &&
      newEnd > t.start
    );

    if (overlapping.length === 1 && task.start !== null) {
      // swap positions between two already-placed tasks
      const other = overlapping[0];
      const otherOldStart = other.start;
      other.start = task.start;
      task.start = newStart;
      // if swapped task no longer fits cleanly, just leave as computed
      void otherOldStart;
    } else if (overlapping.length > 0) {
      // bump any overlapping tasks back to the pool, then place this one
      overlapping.forEach(t => { t.start = null; });
      task.start = newStart;
    } else {
      task.start = newStart;
    }
  }

  // --- Task creation ---

  taskForm.addEventListener('submit', e => {
    e.preventDefault();
    const title = taskTitleInput.value.trim();
    const duration = Math.max(10, parseInt(taskDurationInput.value, 10) || 30);
    const color = taskColorInput.value;
    if (!title) return;

    state.tasks.push({ id: genId(), title, duration, color, start: null });
    saveState();
    render();
    taskTitleInput.value = '';
    taskTitleInput.focus();
  });

  // --- Editing ---

  function openEdit(id) {
    const task = state.tasks.find(t => t.id === id);
    if (!task) return;
    editingTaskId = id;
    editTitle.value = task.title;
    editDuration.value = task.duration;
    editColor.value = task.color;
    editDialog.classList.remove('hidden');
  }

  function closeEdit() {
    editingTaskId = null;
    editDialog.classList.add('hidden');
  }

  editForm.addEventListener('submit', e => {
    e.preventDefault();
    const task = state.tasks.find(t => t.id === editingTaskId);
    if (task) {
      task.title = editTitle.value.trim() || task.title;
      task.duration = Math.max(10, parseInt(editDuration.value, 10) || task.duration);
      task.color = editColor.value;
      if (task.start !== null) {
        const total = dayTotalMinutes();
        task.start = Math.max(0, Math.min(task.start, total - task.duration));
      }
      saveState();
      render();
    }
    closeEdit();
  });

  editDelete.addEventListener('click', () => {
    state.tasks = state.tasks.filter(t => t.id !== editingTaskId);
    saveState();
    render();
    closeEdit();
  });

  editCancel.addEventListener('click', closeEdit);

  // --- Day range ---

  function onRangeChange() {
    const newStart = dayStartInput.value;
    const newEnd = dayEndInput.value;
    if (timeToMinutes(newEnd) <= timeToMinutes(newStart)) return;
    state.dayStart = newStart;
    state.dayEnd = newEnd;
    saveState();
    render();
  }

  dayStartInput.addEventListener('change', onRangeChange);
  dayEndInput.addEventListener('change', onRangeChange);

  render();
})();
