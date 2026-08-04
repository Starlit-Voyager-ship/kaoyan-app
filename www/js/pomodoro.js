/* ========================================
   番茄专注计时模块（待办卡片 + 正向计时）
   ======================================== */

const Pomodoro = {
  timer: null,
  elapsed: 0,
  isRunning: false,
  currentTodo: null,
  todos: [],
  tasks: [],
  statsRange: 'day',

  init() {
    this.bindEvents();
    this.loadTodos();
    this.loadTasks();
    this.loadTodayStats();
    this.renderTodos();
    this.renderTasks();
    this.updateStatsView();
  },

  bindEvents() {
    // 顶部 Tab
    document.querySelectorAll('.pomo-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchPanel(tab.dataset.pomoTab));
    });

    // 待办
    document.getElementById('pomo-add-todo').addEventListener('click', () => this.openTodoModal());
    document.getElementById('pomo-todo-save').addEventListener('click', () => this.saveTodo());
    document.getElementById('pomo-todo-cancel').addEventListener('click', () => this.closeTodoModal());
    document.getElementById('pomo-todo-overlay').addEventListener('click', () => this.closeTodoModal());
    document.getElementById('pomo-todo-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveTodo();
    });

    // 待办（每日清单 + 跨天顺延）
    document.getElementById('pomo-add-task').addEventListener('click', () => this.openTaskModal());
    document.getElementById('pomo-task-save').addEventListener('click', () => this.saveTask());
    document.getElementById('pomo-task-cancel').addEventListener('click', () => this.closeTaskModal());
    document.getElementById('pomo-task-overlay').addEventListener('click', () => this.closeTaskModal());
    document.getElementById('pomo-task-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveTask();
    });

    // 计时器
    document.getElementById('pomo-timer-back').addEventListener('click', () => this.leaveTimer());
    document.getElementById('pomo-timer-toggle').addEventListener('click', () => this.toggleTimer());
    document.getElementById('pomo-timer-stop').addEventListener('click', () => this.stopTimer());

    // 统计范围
    document.querySelectorAll('.pomo-stats-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.statsRange = tab.dataset.range;
        document.querySelectorAll('.pomo-stats-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.updateStatsView();
      });
    });
  },

  /* ---------- 视图切换 ---------- */
  switchPanel(name) {
    document.querySelectorAll('.pomo-tab').forEach(t => t.classList.toggle('active', t.dataset.pomoTab === name));
    document.querySelectorAll('.pomo-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'pomo-' + name + '-panel');
    });
    if (name === 'tasks') { this.autoCarryOverTasks(); this.renderTasks(); }
    if (name === 'stats') this.updateStatsView();
  },

  /* ---------- 待办 ---------- */
  loadTodos() {
    const user = Store.getCurrentUser();
    const key = `pomo_todos_${user || 'guest'}`;
    try {
      this.todos = JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
      this.todos = [];
    }
    if (this.todos.length === 0) {
      this.todos = [
        { id: Utils.uid(), title: '背单词', subtitle: '正向计时' },
        { id: Utils.uid(), title: '数学', subtitle: '正向计时' },
        { id: Utils.uid(), title: '英语', subtitle: '正向计时' }
      ];
      this.saveTodos();
    }
  },

  saveTodos() {
    const user = Store.getCurrentUser();
    const key = `pomo_todos_${user || 'guest'}`;
    localStorage.setItem(key, JSON.stringify(this.todos));
  },

  renderTodos() {
    const list = document.getElementById('pomo-todo-list');
    const empty = document.getElementById('pomo-todo-empty');
    list.innerHTML = '';

    if (this.todos.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    this.todos.forEach(todo => {
      const card = document.createElement('div');
      card.className = 'pomo-todo-card';
      card.innerHTML = `
        <div class="pomo-todo-info">
          <div class="pomo-todo-title">${this.escapeHtml(todo.title)}</div>
          <div class="pomo-todo-sub">正向计时</div>
        </div>
        <div class="pomo-todo-actions">
          <button class="pomo-todo-del" title="删除" data-id="${todo.id}">
            <svg class="ico" viewBox="0 0 24 24" style="width:14px;height:14px"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
          <button class="pomo-start-btn" data-id="${todo.id}">开始</button>
        </div>
      `;
      card.querySelector('.pomo-start-btn').addEventListener('click', () => this.startTodo(todo.id));
      card.querySelector('.pomo-todo-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteTodo(todo.id);
      });
      list.appendChild(card);
    });
  },

  openTodoModal() {
    document.getElementById('pomo-todo-modal').style.display = 'block';
    document.getElementById('pomo-todo-name').value = '';
    document.getElementById('pomo-todo-name').focus();
  },

  closeTodoModal() {
    document.getElementById('pomo-todo-modal').style.display = 'none';
  },

  saveTodo() {
    const input = document.getElementById('pomo-todo-name');
    const title = input.value.trim();
    if (!title) return;
    this.todos.push({ id: Utils.uid(), title, subtitle: '正向计时' });
    this.saveTodos();
    this.renderTodos();
    this.closeTodoModal();
  },

  deleteTodo(id) {
    this.todos = this.todos.filter(t => t.id !== id);
    this.saveTodos();
    this.renderTodos();
  },

  /* ---------- 待办（每日清单 + 跨天顺延） ---------- */
  loadTasks() {
    const user = Store.getCurrentUser();
    const key = `pomo_tasks_${user || 'guest'}`;
    try {
      this.tasks = JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
      this.tasks = [];
    }
    this.autoCarryOverTasks();
  },

  saveTasks() {
    const user = Store.getCurrentUser();
    const key = `pomo_tasks_${user || 'guest'}`;
    localStorage.setItem(key, JSON.stringify(this.tasks));
  },

  autoCarryOverTasks() {
    const today = Utils.today();
    let changed = false;
    this.tasks.forEach(t => {
      if (!t.completed && t.date && t.date < today) {
        t.date = today;
        t.carryOver = (t.carryOver || 0) + 1;
        changed = true;
      }
    });
    if (changed) this.saveTasks();
  },

  renderTasks() {
    const list = document.getElementById('pomo-task-list');
    const empty = document.getElementById('pomo-task-empty');
    const summary = document.getElementById('pomo-task-summary');
    if (!list) return;
    const today = Utils.today();

    const todo = this.tasks.filter(t => t.date === today && !t.completed);
    const done = this.tasks.filter(t => t.date === today && t.completed);

    list.innerHTML = '';
    if (todo.length === 0 && done.length === 0) {
      empty.style.display = 'block';
      summary.textContent = '';
      return;
    }
    empty.style.display = 'none';

    const all = [...todo, ...done];
    all.forEach(t => {
      const isDone = !!t.completed;
      const carry = (t.carryOver && t.carryOver > 0)
        ? `<span class="pomo-task-carry">顺延 ${t.carryOver} 次</span>` : '';
      const checkSvg = isDone
        ? '<svg class="ico" viewBox="0 0 24 24" style="width:16px;height:16px" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>'
        : '';
      const card = document.createElement('div');
      card.className = 'pomo-task-card' + (isDone ? ' pomo-task-card--done' : '');
      card.dataset.id = t.id;
      card.innerHTML = `
        <button class="pomo-task-check${isDone ? ' pomo-task-check--done' : ''}" data-id="${t.id}" aria-label="${isDone ? '取消完成' : '完成'}">${checkSvg}</button>
        <div class="pomo-task-info">
          <div class="pomo-task-title">${this.escapeHtml(t.title)}</div>
          ${carry}
        </div>
        <button class="pomo-task-del" data-id="${t.id}" aria-label="删除">
          <svg class="ico" viewBox="0 0 24 24" style="width:15px;height:15px" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
        </button>`;
      list.appendChild(card);
    });

    list.querySelectorAll('.pomo-task-check').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleTaskComplete(btn.dataset.id);
      });
    });
    list.querySelectorAll('.pomo-task-del').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (typeof confirmDeleteItem === 'function') {
          confirmDeleteItem('删除待办', '确定删除这条待办吗？', () => this.deleteTask(id));
        } else if (confirm('确定删除这条待办吗？')) {
          this.deleteTask(id);
        }
      });
    });

    const overdue = this.tasks.filter(t => !t.completed && t.date && t.date < today).length;
    summary.textContent = `今日 ${todo.length + done.length} 项 · 待完成 ${todo.length} · 已完成 ${done.length}${overdue > 0 ? ' · 待顺延 ' + overdue : ''}`;
  },

  openTaskModal() {
    const m = document.getElementById('pomo-task-modal');
    if (!m) return;
    m.style.display = 'block';
    const input = document.getElementById('pomo-task-input');
    input.value = '';
    input.focus();
  },

  closeTaskModal() {
    const m = document.getElementById('pomo-task-modal');
    if (m) m.style.display = 'none';
  },

  saveTask() {
    const input = document.getElementById('pomo-task-input');
    const title = (input.value || '').trim();
    if (!title) return;
    this.addTask(title);
    this.closeTaskModal();
  },

  addTask(title) {
    this.tasks.push({
      id: Utils.uid(),
      title,
      date: Utils.today(),
      completed: false,
      completedAt: null,
      carryOver: 0,
      createdAt: new Date().toISOString()
    });
    this.saveTasks();
    this.renderTasks();
  },

  toggleTaskComplete(id) {
    const t = this.tasks.find(x => x.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    this.saveTasks();
    this.renderTasks();
  },

  deleteTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
    this.saveTasks();
    this.renderTasks();
  },

  /* ---------- 计时 ---------- */
  startTodo(id) {
    this.currentTodo = this.todos.find(t => t.id === id);
    if (!this.currentTodo) return;

    this.elapsed = 0;
    this.isRunning = false;
    document.getElementById('pomo-task-name').textContent = this.currentTodo.title;
    document.getElementById('pomo-timer-display').textContent = '00:00:00';
    document.getElementById('pomo-timer-toggle').textContent = '开始';

    this.switchPanel('timer');
  },

  toggleTimer() {
    if (this.isRunning) {
      this.pauseTimer();
    } else {
      this.resumeTimer();
    }
  },

  resumeTimer() {
    if (this.isRunning) return;
    this.isRunning = true;
    document.getElementById('pomo-timer-toggle').textContent = '暂停';
    document.title = '专注中 - 考研学习助手';
    this.timer = setInterval(() => {
      this.elapsed++;
      this.updateTimerDisplay();
    }, 1000);
  },

  pauseTimer() {
    this.isRunning = false;
    clearInterval(this.timer);
    document.getElementById('pomo-timer-toggle').textContent = '继续';
    document.title = '已暂停 - 考研学习助手';
  },

  stopTimer() {
    const wasRunning = this.isRunning;
    this.pauseTimer();
    const minutes = Math.floor(this.elapsed / 60);

    if (minutes > 0 && this.currentTodo) {
      // 记录到数据库
      Store.put('pomodoro_records', {
        id: Utils.uid(),
        username: Store.getCurrentUser(),
        date: Utils.today(),
        duration: minutes,
        task: this.currentTodo.title,
        completed: true,
        timestamp: new Date().toISOString()
      });

      const coinPer = (window.Pet && Pet.LEARN_REWARDS && Pet.LEARN_REWARDS.pomodoro_per_min && Pet.LEARN_REWARDS.pomodoro_per_min.per) || 1;
      Pet.onLearnReward('pomodoro_per_min', minutes).then(() => {});
      Utils.toast(`专注结束！${this.currentTodo.title} ${minutes} 分钟，+${minutes * coinPer} 金币`);
    } else if (wasRunning) {
      Utils.toast('专注时间不足1分钟，未记录');
    }

    this.loadTodayStats();
    this.updateStatsView();
    if (typeof app !== 'undefined' && app.updateHomeStats) app.updateHomeStats();

    this.leaveTimer();
  },

  leaveTimer() {
    this.pauseTimer();
    this.elapsed = 0;
    this.currentTodo = null;
    document.title = '考研学习助手';
    this.switchPanel('todo');
  },

  updateTimerDisplay() {
    document.getElementById('pomo-timer-display').textContent = Utils.formatDuration(this.elapsed);
  },

  /* ---------- 统计 ---------- */
  async loadTodayStats() {
    const user = Store.getCurrentUser();
    const todaySessions = await Store.getTodaySessions(user);
    const todayMinutes = await Store.getTodayFocusMinutes(user);
    const totalMinutes = await Store.getTotalFocusMinutes(user);

    document.getElementById('today-sessions').textContent = todaySessions;
    document.getElementById('today-total-minutes').textContent = todayMinutes;
    document.getElementById('total-sessions').textContent = await this.getTotalSessions(user);
    document.getElementById('total-hours').textContent = Math.floor(totalMinutes / 60);
    document.getElementById('total-minutes-rem').textContent = totalMinutes % 60;
    document.getElementById('avg-daily').textContent = await this.getAvgDailyMinutes(user);
  },

  async getTotalSessions(username) {
    const records = await Store.getUserData('pomodoro_records', username);
    return records.filter(r => r.completed).length;
  },

  async getAvgDailyMinutes(username) {
    const records = await Store.getUserData('pomodoro_records', username);
    const completed = records.filter(r => r.completed);
    if (completed.length === 0) return 0;
    const days = new Set(completed.map(r => r.date)).size || 1;
    const total = completed.reduce((sum, r) => sum + (r.duration || 0), 0);
    return Math.round(total / days);
  },

  async updateStatsView() {
    const user = Store.getCurrentUser();
    const today = Utils.today();
    document.getElementById('stats-today-date').textContent = today;
    document.getElementById('stats-dist-date').textContent = today;
    document.getElementById('stats-history-month').textContent = today.slice(0, 4) + '年' + today.slice(5, 7) + '月';

    await this.loadTodayStats();
    await this.renderFocusChart(user);
    await this.renderHourChart(user);
    await this.renderHistoryList(user);
  },

  async renderFocusChart(username) {
    const container = document.getElementById('pomo-focus-chart');
    const records = await Store.getUserData('pomodoro_records', username);
    const completed = records.filter(r => r.completed);

    if (completed.length === 0) {
      container.innerHTML = '<p class="pomo-chart-empty">暂无专注数据，点击待办上的开始按钮来专注计时吧</p>';
      return;
    }

    const data = this.groupByTask(completed, this.statsRange);
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) {
      container.innerHTML = '<p class="pomo-chart-empty">该时段暂无专注数据</p>';
      return;
    }

    // Top 5，其余归并到"其他"
    const colors = ['var(--primary)', 'var(--c-sky)', 'var(--c-cyan)', 'var(--c-coral)', 'var(--c-amber)', 'var(--c-violet)'];
    let chartData = entries.slice(0, 5).map(([name, min], i) => ({ name, min, color: colors[i % colors.length] }));
    const otherMin = entries.slice(5).reduce((s, [, m]) => s + m, 0);
    if (otherMin > 0) {
      chartData.push({ name: '其他', min: otherMin, color: colors[5] });
    }

    const total = chartData.reduce((s, d) => s + d.min, 0);
    container.innerHTML = this.buildPieChart(chartData, total);
  },

  groupByTask(records, range) {
    const filtered = this.filterByRange(records, range);
    const data = {};
    filtered.forEach(r => {
      const task = r.task || '未命名';
      data[task] = (data[task] || 0) + (r.duration || 0);
    });
    return data;
  },

  filterByRange(records, range) {
    const today = Utils.today();
    if (range === 'day') return records.filter(r => r.date === today);
    if (range === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      return records.filter(r => new Date(r.date) >= weekAgo);
    }
    return records.filter(r => (r.date || '').startsWith(today.slice(0, 7)));
  },

  buildPieChart(data, total) {
    const radius = 80;
    const cx = 90;
    const cy = 90;
    let startAngle = -Math.PI / 2;
    const paths = [];
    data.forEach(d => {
      const angle = (d.min / total) * Math.PI * 2;
      const endAngle = startAngle + angle;
      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);
      const largeArc = angle > Math.PI ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      paths.push(`<path d="${path}" fill="${d.color}" stroke="#fff" stroke-width="2"></path>`);
      startAngle = endAngle;
    });

    const legend = data.map(d => {
      const pct = total ? Math.round((d.min / total) * 100) : 0;
      return `<div class="pie-legend-row">
        <span class="pie-legend-dot" style="background:${d.color}"></span>
        <span class="pie-legend-name">${this.escapeHtml(d.name)}</span>
        <span class="pie-legend-val">${d.min}分钟 · ${pct}%</span>
      </div>`;
    }).join('');

    return `
      <div class="pie-chart-wrap">
        <div class="pie-chart-left">
          <svg viewBox="0 0 180 180" class="pie-svg">${paths.join('')}</svg>
          <div class="pie-total">
            <div class="pie-total-num">${Math.floor(total / 60)}小时${total % 60}分</div>
            <div class="pie-total-label">总时长</div>
          </div>
        </div>
        <div class="pie-chart-right">${legend}</div>
      </div>
    `;
  },

  async renderHourChart(username) {
    const container = document.getElementById('pomo-hour-chart');
    const records = await Store.getUserData('pomodoro_records', username);
    const completed = records.filter(r => r.completed && r.timestamp);

    if (completed.length === 0) {
      container.innerHTML = '<p class="pomo-chart-empty">暂无时段数据</p>';
      return;
    }

    const hours = new Array(24).fill(0);
    completed.forEach(r => {
      const h = new Date(r.timestamp).getHours();
      hours[h] += (r.duration || 0);
    });
    const max = Math.max(...hours, 1);

    container.innerHTML = '<div class="pomo-hour-chart">' + hours.map((val, i) => {
      const pct = (val / max) * 100;
      return `<div class="pomo-hour-bar" style="height:${pct}%"><span class="pomo-hour-tip">${i}点</span></div>`;
    }).join('') + '</div>';
  },

  async renderHistoryList(username) {
    const list = document.getElementById('pomo-history-list');
    const records = await Store.getUserData('pomodoro_records', username);
    const completed = records.filter(r => r.completed).sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    if (completed.length === 0) {
      list.innerHTML = '<p class="pomo-chart-empty">暂无历史记录</p>';
      return;
    }

    list.innerHTML = completed.slice(0, 10).map(r => `
      <div class="pomo-history-item">
        <span class="pomo-history-date">${r.date || '--'} ${r.task || '专注'}</span>
        <span class="pomo-history-min">${r.duration || 0} 分钟</span>
      </div>
    `).join('');
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
};
