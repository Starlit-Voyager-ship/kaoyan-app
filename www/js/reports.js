/* ========================================
   学习数据报表模块（日报/周报）
   支持按日期查询日报、按周查询周报
   生成后自动缓存，进入页面自动加载最新
   ======================================== */

const Reports = {
  currentWeekOffset: 0, // 0=本周, -1=上周, 1=下周...

  init() {
    this.bindEvents();
    // 初始化日期选择器为今天
    const dateInput = document.getElementById('daily-date-input');
    if (dateInput) dateInput.value = Utils.today();
    // 初始化周显示
    this.updateWeekLabel();
    // 自动加载当前面板的缓存报告
    this.loadCachedDaily();
  },

  bindEvents() {
    // Tab 切换
    document.querySelectorAll('.report-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('report-' + tab.dataset.report).classList.add('active');
        // 切换面板时加载对应缓存
        if (tab.dataset.report === 'daily') this.loadCachedDaily();
        else this.loadCachedWeekly();
      });
    });

    // 日报：日期切换时加载缓存
    document.getElementById('daily-date-input')?.addEventListener('change', () => this.loadCachedDaily());

    // 生成按钮
    document.getElementById('generate-daily')?.addEventListener('click', () => this.generateDaily());
    document.getElementById('generate-weekly')?.addEventListener('click', () => this.generateWeekly());

    // 周导航
    document.getElementById('week-prev')?.addEventListener('click', () => {
      this.currentWeekOffset--;
      this.updateWeekLabel();
      this.loadCachedWeekly();
    });
    document.getElementById('week-next')?.addEventListener('click', () => {
      this.currentWeekOffset++;
      this.updateWeekLabel();
      this.loadCachedWeekly();
    });
  },

  // ---- 周计算辅助 ----
  getWeekRange(offset = 0) {
    const now = new Date();
    // 调整到目标周的周一
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1 + offset * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10)
    };
  },

  updateWeekLabel() {
    const w = this.getWeekRange(this.currentWeekOffset);
    const el = document.getElementById('week-label');
    if (!el) return;
    if (this.currentWeekOffset === 0) el.textContent = '本周';
    else if (this.currentWeekOffset === -1) el.textContent = '上周';
    else el.textContent = `${w.start} ~ ${w.end}`;
  },

  // ---- 缓存读写 ----
  async getCachedReport(type, key) {
    const user = Store.getCurrentUser();
    const all = await Store.getUserData('reports', user);
    return all.find(r => r.type === type && r.dateKey === key) || null;
  },

  // ---- 日报 ----

  async loadCachedDaily() {
    const dateInput = document.getElementById('daily-date-input');
    const date = dateInput?.value || Utils.today();
    const cached = await this.getCachedReport('daily', date);
    // 旧版缓存缺 prev / last7 字段 → 直接当无缓存，逼一次重新生成
    const isStale = cached && (!cached.data || cached.data.prev === undefined || !Array.isArray(cached.data.last7));
    if (cached && !isStale) {
      this.renderDailyReport(cached.data, date);
    } else {
      // 同一日期重生成（覆盖旧缓存）
      document.getElementById('daily-report-content').innerHTML =
        '<p class="empty-hint" style="padding:24px 0;text-align:center;color:var(--text-light)">正在重新生成今日报表…</p>';
      const dateInput = document.getElementById('daily-date-input');
      // 直接复用 generateDaily（它会读 dateInput 的值覆盖缓存）
      await this.generateDaily();
    }
  },

  async generateDaily() {
    const user = Store.getCurrentUser();
    const dateInput = document.getElementById('daily-date-input');
    const targetDate = dateInput?.value || Utils.today();

    // 昨日对比：只与 targetDate - 1 对比
    const prevDate = this.shiftDate(targetDate, -1);

    // 一次性拉所有数据，闭包内分别按 date 过滤
    const [focusAll, wordsAll, questionsAll, chatsAll, tasksAll] = await Promise.all([
      Store.getUserData('pomodoro_records', user),
      Store.getUserData('vocab_words', user),
      Store.getUserData('math_questions', user),
      Store.getUserData('ai_chats', user),
      Store.getAll('pomo_tasks')
    ]);

    const inDate = (r) => r && r.date === targetDate && r.completed;
    const prevInDate = (r) => r && r.date === prevDate && r.completed;

    const todayFocus = focusAll.filter(inDate);
    const prevFocus = focusAll.filter(prevInDate);
    const totalMinutes = todayFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = todayFocus.length;
    const prevTotalMinutes = prevFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const prevSessions = prevFocus.length;

    const todayWords = wordsAll.filter(w => w.firstLearned === targetDate && !w.isWrong).length;
    const wrongWords = wordsAll.filter(w => w.isWrong && w.lastReview === targetDate).length;
    const todayMath = questionsAll.filter(q => q.createdAt && q.createdAt.startsWith(targetDate)).length;
    const todayChats = chatsAll.filter(c => c.timestamp && c.timestamp.startsWith(targetDate)).length;

    // 待办完成数（按 completedAt 日期归到那一天）
    const myTasks = (tasksAll || []).filter(t => t && t.username === user);
    const taskDone = myTasks.filter(t => t.completed && (t.completedAt || '').slice(0, 10) === targetDate).length;
    const prevTaskDone = myTasks.filter(t => t.completed && (t.completedAt || '').slice(0, 10) === prevDate).length;

    // 近 7 天（含今日）每日专注分钟，用于小趋势图
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
      const dStr = this.shiftDate(targetDate, -i);
      const mins = focusAll
        .filter(r => r.date === dStr && r.completed)
        .reduce((s, r) => s + (r.duration || 0), 0);
      const ct = focusAll.filter(r => r.date === dStr && r.completed).length;
      last7.push({ date: dStr, minutes: mins, sessions: ct });
    }

    const reportData = {
      totalMinutes, sessions, todayWords, wrongWords, todayMath, todayChats,
      taskDone,
      prev: {
        totalMinutes: prevTotalMinutes,
        sessions: prevSessions,
        taskDone: prevTaskDone
      },
      last7
    };

    // 渲染
    this.renderDailyReport(reportData, targetDate);

    // 缓存（覆盖式：同日期只保留最新一份）
    await Store.put('reports', {
      id: `daily_${user}_${targetDate}`,
      username: user,
      type: 'daily',
      dateKey: targetDate,
      data: reportData,
      generatedAt: new Date().toISOString()
    });

    Utils.toast(`${targetDate} 日报已生成！`);
  },

  shiftDate(dateStr, deltaDays) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  },

  renderDailyReport(data, dateStr) {
    const displayDate = Utils.formatDate(dateStr) || dateStr;
    const reportEl = document.getElementById('daily-report-content');
    const isToday = dateStr === Utils.today();

    // 同比徽章 helper
    const badge = (cur, prev) => {
      if (cur === prev) return '<span class="report-diff report-diff--flat">— 与昨日持平</span>';
      if (prev === 0 && cur > 0) return '<span class="report-diff report-diff--up">↑ 新增 +' + cur + '</span>';
      if (cur === 0) return '<span class="report-diff report-diff--down">↓ -100%</span>';
      const diff = cur - prev;
      const pct = Math.round((diff / prev) * 100);
      if (diff > 0) return `<span class="report-diff report-diff--up">↑ +${pct}%</span>`;
      return `<span class="report-diff report-diff--down">↓ ${pct}%</span>`;
    };

    // 通用 SVG 图标
    const ico = (path) =>
      `<svg class="report-stat-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
    const ICONS = {
      clock: ico('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
      tomato: ico('<path d="M12 3a9 9 0 1 0 9 9c0-2-1.5-3-3-3s-1.5 1-3 1-1.5-2-1.5-3 1-3-1.5-4"/>'),
      book:   ico('<path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/>'),
      warn:   ico('<path d="M12 3 2 21h20z"/><path d="M12 10v5M12 18h0"/>'),
      math:   ico('<path d="M4 6h16M6 6v12M4 12h4M14 6l4 12M18 6v12"/>'),
      ai:     ico('<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M9 7V4h6v3M12 11v0"/>'),
      task:   ico('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>')
    };

    // 近 7 天柱图
    const last7 = (data.last7 && data.last7.length === 7) ? data.last7 : this._emptyLast7(dateStr);
    const maxM = Math.max(...last7.map(x => x.minutes), 1);

    reportEl.innerHTML = `
      <h4><svg class="ico" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></svg> ${isToday ? '今日' : displayDate} 学习日报</h4>

      <div class="report-cards">
        <div class="report-card report-card--focus">
          <div class="report-card-head">${ICONS.clock} 专注时长</div>
          <div class="report-card-val">${data.totalMinutes}<span class="unit">分钟</span></div>
          <div class="report-card-sub">${data.sessions} 个番茄钟</div>
          ${badge(data.totalMinutes, data.prev?.totalMinutes ?? 0)}
        </div>
        <div class="report-card report-card--task">
          <div class="report-card-head">${ICONS.task} 待办完成</div>
          <div class="report-card-val">${data.taskDone || 0}<span class="unit">项</span></div>
          <div class="report-card-sub">勾选完成的当日待办</div>
          ${badge(data.taskDone || 0, data.prev?.taskDone ?? 0)}
        </div>
        <div class="report-card report-card--pomo">
          <div class="report-card-head">${ICONS.tomato} 完成番茄</div>
          <div class="report-card-val">${data.sessions}<span class="unit">次</span></div>
          <div class="report-card-sub">当日完整专注次数</div>
          ${badge(data.sessions, data.prev?.sessions ?? 0)}
        </div>
      </div>

      <div class="report-stat-row"><span class="label">新背单词</span><span class="value">${data.todayWords} 个</span></div>
      <div class="report-stat-row"><span class="label">错词复习</span><span class="value">${data.wrongWords} 个</span></div>
      <div class="report-stat-row"><span class="label">数学录题</span><span class="value">${data.todayMath} 道</span></div>
      <div class="report-stat-row"><span class="label">AI 咨询</span><span class="value">${data.todayChats} 次</span></div>

      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M4 20V10M9 20V4M14 20v-7M19 20v-11"/></svg> 近 7 天专注时长（含今日）</h4>
      <div class="report-mini-chart">
        ${last7.map((d, i) => {
          const h = Math.max(4, Math.round((d.minutes / maxM) * 100));
          const isLast = i === last7.length - 1;
          const mmdd = d.date.slice(5);
          const zero = d.minutes === 0 ? ' is-zero' : '';
          const todayCls = isLast ? ' is-today' : '';
          return `
            <div class="report-mini-col${todayCls}${zero}">
              <span class="report-mini-val">${d.minutes || '·'}</span>
              <div class="report-mini-bar" style="height:${h}%"></div>
              <span class="report-mini-label">${mmdd}${isLast ? '<br><span class="report-mini-tag">今日</span>' : ''}</span>
            </div>`;
        }).join('')}
      </div>

      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.7c.5.4.8 1 .8 1.6V17h6v-1.7c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/></svg> AI 学习建议</h4>
      <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.8">
        ${this.generateSuggestion(data)}
      </p>
    `;
  },

  _emptyLast7(targetDate) {
    const arr = [];
    for (let i = 6; i >= 0; i--) {
      arr.push({ date: this.shiftDate(targetDate, -i), minutes: 0, sessions: 0 });
    }
    return arr;
  },

  // ---- 周报 ----

  async loadCachedWeekly() {
    const w = this.getWeekRange(this.currentWeekOffset);
    const key = w.start; // 用周一起始作为 key
    const cached = await this.getCachedReport('weekly', key);
    const isStale = cached && (!cached.data || cached.data.prev === undefined);
    if (cached && !isStale) {
      this.renderWeeklyReport(cached.data, cached.weekStart, cached.weekEnd);
    } else {
      document.getElementById('weekly-report-content').innerHTML =
        '<p class="empty-hint" style="padding:24px 0;text-align:center;color:var(--text-light)">正在重新生成本周报表…</p>';
      await this.generateWeekly();
    }
  },

  async generateWeekly() {
    const user = Store.getCurrentUser();
    const week = this.getWeekRange(this.currentWeekOffset);
    const prevWeek = {
      start: this.shiftDate(week.start, -7),
      end: this.shiftDate(week.end, -7)
    };

    // 收集目标周数据
    const [focusRecords, words, questions, chats] = await Promise.all([
      Store.getUserData('pomodoro_records', user),
      Store.getUserData('vocab_words', user),
      Store.getUserData('math_questions', user),
      Store.getUserData('ai_chats', user)
    ]);

    const weekFocus = focusRecords.filter(r => r.date >= week.start && r.date <= week.end && r.completed);
    const totalMinutes = weekFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = weekFocus.length;

    const weekNewWords = words.filter(w => w.firstLearned >= week.start && w.firstLearned <= week.end && !w.isWrong).length;
    const weekMath = questions.filter(q => q.createdAt && q.createdAt >= week.start && q.createdAt <= week.end).length;
    const weekChats = chats.filter(c => c.timestamp && c.timestamp >= week.start && c.timestamp <= week.end).length;

    // 每日分布
    const dailyDist = [];
    for (let d = new Date(week.start); d <= new Date(week.end); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayMin = weekFocus.filter(r => r.date === dateStr).reduce((s, r) => s + (r.duration || 0), 0);
      dailyDist.push({ date: dateStr, minutes: dayMin });
    }

    // 上周同期数据
    const prevFocus = focusRecords.filter(r => r.date >= prevWeek.start && r.date <= prevWeek.end && r.completed);
    const prevTotalMinutes = prevFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const prevSessions = prevFocus.length;
    const prevWeekNewWords = words.filter(w => w.firstLearned >= prevWeek.start && w.firstLearned <= prevWeek.end && !w.isWrong).length;
    const prevWeekMath = questions.filter(q => q.createdAt && q.createdAt >= prevWeek.start && q.createdAt <= prevWeek.end).length;
    const prevWeekChats = chats.filter(c => c.timestamp && c.timestamp >= prevWeek.start && c.timestamp <= prevWeek.end).length;

    const avgDaily = Math.round(totalMinutes / 7);

    const reportData = {
      totalMinutes, sessions, weekNewWords, weekMath, weekChats, dailyDist, avgDaily,
      prev: {
        totalMinutes: prevTotalMinutes,
        sessions: prevSessions,
        weekNewWords: prevWeekNewWords,
        weekMath: prevWeekMath,
        weekChats: prevWeekChats
      }
    };

    // 渲染
    this.renderWeeklyReport(reportData, week.start, week.end);

    // 缓存
    await Store.put('reports', {
      id: `weekly_${user}_${week.start}`,
      username: user,
      type: 'weekly',
      dateKey: week.start,
      weekStart: week.start,
      weekEnd: week.end,
      data: reportData,
      generatedAt: new Date().toISOString()
    });

    Utils.toast(`${week.start} ~ ${week.end} 周报已生成！`);
  },

  renderWeeklyReport(data, weekStart, weekEnd) {
    const reportEl = document.getElementById('weekly-report-content');
    const maxMin = Math.max(...data.dailyDist.map(x => x.minutes), 1);

    const badge = (cur, prev) => {
      if (cur === prev) return '<span class="report-diff report-diff--flat">— 与上周持平</span>';
      if (prev === 0 && cur > 0) return '<span class="report-diff report-diff--up">↑ 新增 +' + cur + '</span>';
      if (cur === 0) return '<span class="report-diff report-diff--down">↓ -100%</span>';
      const diff = cur - prev;
      const pct = Math.round((diff / prev) * 100);
      if (diff > 0) return `<span class="report-diff report-diff--up">↑ +${pct}%</span>`;
      return `<span class="report-diff report-diff--down">↓ ${pct}%</span>`;
    };

    const safePrev = data.prev || {};

    reportEl.innerHTML = `
      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l3.5-4 3 3L20 7"/></svg> ${weekStart} ~ ${weekEnd} 周度学习报告</h4>

      <div class="report-cards">
        <div class="report-card report-card--focus">
          <div class="report-card-head">总专注时长</div>
          <div class="report-card-val">${data.totalMinutes}<span class="unit">分钟</span></div>
          <div class="report-card-sub">${data.sessions} 个番茄钟 · 日均 ${data.avgDaily}m</div>
          ${badge(data.totalMinutes, safePrev.totalMinutes ?? 0)}
        </div>
        <div class="report-card report-card--pomo">
          <div class="report-card-head">完成番茄</div>
          <div class="report-card-val">${data.sessions}<span class="unit">次</span></div>
          <div class="report-card-sub">当周完整专注次数</div>
          ${badge(data.sessions, safePrev.sessions ?? 0)}
        </div>
        <div class="report-card report-card--math">
          <div class="report-card-head">数学题目</div>
          <div class="report-card-val">${data.weekMath}<span class="unit">道</span></div>
          <div class="report-card-sub">当周新录入题</div>
          ${badge(data.weekMath, safePrev.weekMath ?? 0)}
        </div>
      </div>

      <div class="report-stat-row"><span class="label">新学单词</span><span class="value">${data.weekNewWords} 个 ${badge(data.weekNewWords, safePrev.weekNewWords ?? 0)}</span></div>
      <div class="report-stat-row"><span class="label">AI咨询</span><span class="value">${data.weekChats} 次 ${badge(data.weekChats, safePrev.weekChats ?? 0)}</span></div>

      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M4 20V10M9 20V4M14 20v-7M19 20v-11"/></svg> 每日专注时长分布</h4>
      <div class="report-mini-chart report-mini-chart--lg">
        ${data.dailyDist.map((d, i) => {
          const h = Math.max(4, Math.round((d.minutes / maxMin) * 100));
          const mmdd = d.date.slice(5);
          const wkday = ['一','二','三','四','五','六','日'][i] || '';
          const zero = d.minutes === 0 ? ' is-zero' : '';
          return `
            <div class="report-mini-col${zero}">
              <span class="report-mini-val">${d.minutes || '·'}</span>
              <div class="report-mini-bar" style="height:${h}%"></div>
              <span class="report-mini-label">周${wkday}<br>${mmdd}</span>
            </div>`;
        }).join('')}
      </div>

      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.7c.5.4.8 1 .8 1.6V17h6v-1.7c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/></svg> 周度总结与建议</h4>
      <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.8;margin-top:8px">
        ${this.generateWeeklySuggestion(data)}
      </p>
    `;
  },

  // ---- 建议 ----

  generateSuggestion(data) {
    const suggestions = [];

    if (data.totalMinutes < 60) suggestions.push('今天专注时长偏少，建议至少完成2-3个番茄钟（50-75分钟）的有效学习。');
    if (data.totalMinutes >= 120) suggestions.push('今天的专注时长很棒！保持这个节奏，注意适当休息。');
    if (data.todayWords < 5) suggestions.push('单词背诵量偏低，建议每天至少新学15-20个单词。');
    if (data.wrongWords > 5) suggestions.push(`错词数量较多(${data.wrongWords}个)，建议重点回顾错词本，加强记忆。`);
    if (data.todayMath === 0) suggestions.push('今天还没有录入数学题目，遇到不会的题记得用AI助理拍照录入。');
    if (data.sessions > 0) suggestions.push(`完成了${data.sessions}个番茄钟，每分钟都算数！继续加油！`);

    if (suggestions.length === 0) suggestions.push('继续保持良好的学习节奏！');

    return suggestions.join('<br><br>');
  },

  generateWeeklySuggestion(data) {
    const suggestions = [];

    if (data.avgDaily < 45) suggestions.push('本周日均专注时长不足1小时，建议下周提高每日最低目标到60分钟。');
    if (data.avgDaily >= 90) suggestions.push('本周学习强度很好！注意劳逸结合，避免疲劳战。');
    if (data.weekNewWords < 30) suggestions.push('单词积累速度较慢，建议每天固定时间背词。');
    if (data.weekMath < 3) suggestions.push('数学题目练习量不够，建议增加做题和错题整理。');

    suggestions.push('坚持就是胜利，每周的积累都会在考场上体现出来！');

    return suggestions.join('<br><br>');
  }
};
