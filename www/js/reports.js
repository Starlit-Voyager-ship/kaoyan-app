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
    if (cached) {
      this.renderDailyReport(cached.data, date);
    } else {
      document.getElementById('daily-report-content').innerHTML =
        '<p class="empty-hint" style="padding:40px 0;text-align:center;color:var(--text-light)">该日暂无报表，点击"生成"按钮创建</p>';
    }
  },

  async generateDaily() {
    const user = Store.getCurrentUser();
    const dateInput = document.getElementById('daily-date-input');
    const targetDate = dateInput?.value || Utils.today();

    // 收集目标日期数据
    const focusRecords = await Store.getUserData('pomodoro_records', user);
    const todayFocus = focusRecords.filter(r => r.date === targetDate && r.completed);
    const totalMinutes = todayFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = todayFocus.length;

    const words = await Store.getUserData('vocab_words', user);
    const todayWords = words.filter(w => w.firstLearned === targetDate && !w.isWrong).length;
    const wrongWords = words.filter(w => w.isWrong && w.lastReview === targetDate).length;

    const questions = await Store.getUserData('math_questions', user);
    const todayMath = questions.filter(q => q.createdAt && q.createdAt.startsWith(targetDate)).length;

    const chats = await Store.getUserData('ai_chats', user);
    const todayChats = chats.filter(c => c.timestamp && c.timestamp.startsWith(targetDate)).length;

    const reportData = { totalMinutes, sessions, todayWords, wrongWords, todayMath, todayChats };

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

  renderDailyReport(data, dateStr) {
    const displayDate = Utils.formatDate(dateStr) || dateStr;
    const reportEl = document.getElementById('daily-report-content');
    reportEl.innerHTML = `
      <h4><svg class="ico" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/></svg> ${dateStr === Utils.today() ? '今日' : displayDate} 学习日报</h4>
      <div class="report-stat-row"><span class="label">专注时长</span><span class="value">${data.totalMinutes} 分钟 (${data.sessions}个番茄)</span></div>
      <div class="report-stat-row"><span class="label">新背单词</span><span class="value">${data.todayWords} 个</span></div>
      <div class="report-stat-row"><span class="label">错词复习</span><span class="value">${data.wrongWords} 个</span></div>
      <div class="report-stat-row"><span class="label">数学录题</span><span class="value">${data.todayMath} 道</span></div>
      <div class="report-stat-row"><span class="label">AI咨询次数</span><span class="value">${data.todayChats} 次</span></div>
      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.8 10.7c.5.4.8 1 .8 1.6V17h6v-1.7c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z"/></svg> AI学习建议</h4>
      <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.8">
        ${this.generateSuggestion(data)}
      </p>
    `;
  },

  // ---- 周报 ----

  async loadCachedWeekly() {
    const w = this.getWeekRange(this.currentWeekOffset);
    const key = w.start; // 用周一起始作为 key
    const cached = await this.getCachedReport('weekly', key);
    if (cached) {
      this.renderWeeklyReport(cached.data, cached.weekStart, cached.weekEnd);
    } else {
      document.getElementById('weekly-report-content').innerHTML =
        '<p class="empty-hint" style="padding:40px 0;text-align:center;color:var(--text-light)">该周暂无报表，点击"生成"按钮创建</p>';
    }
  },

  async generateWeekly() {
    const user = Store.getCurrentUser();
    const week = this.getWeekRange(this.currentWeekOffset);

    // 收集目标周数据
    const focusRecords = await Store.getUserData('pomodoro_records', user);
    const weekFocus = focusRecords.filter(r => r.date >= week.start && r.date <= week.end && r.completed);
    const totalMinutes = weekFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = weekFocus.length;

    const words = await Store.getUserData('vocab_words', user);
    const weekNewWords = words.filter(w => w.firstLearned >= week.start && w.firstLearned <= week.end && !w.isWrong).length;

    const questions = await Store.getUserData('math_questions', user);
    const weekMath = questions.filter(q => q.createdAt && q.createdAt >= week.start && q.createdAt <= week.end).length;

    const chats = await Store.getUserData('ai_chats', user);
    const weekChats = chats.filter(c => c.timestamp && c.timestamp >= week.start && c.timestamp <= week.end).length;

    // 每日分布
    const dailyDist = [];
    for (let d = new Date(week.start); d <= new Date(week.end); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayMin = weekFocus.filter(r => r.date === dateStr).reduce((s, r) => s + (r.duration || 0), 0);
      dailyDist.push({ date: dateStr, minutes: dayMin });
    }

    const avgDaily = Math.round(totalMinutes / 7);

    const reportData = { totalMinutes, sessions, weekNewWords, weekMath, weekChats, dailyDist, avgDaily };

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

    reportEl.innerHTML = `
      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M4 19V5M4 19h16M7 15l3.5-4 3 3L20 7"/></svg> ${weekStart} ~ ${weekEnd} 周度学习报告</h4>
      <div class="report-stat-row"><span class="label">总专注时长</span><span class="value">${data.totalMinutes} 分钟 (${data.sessions}个番茄)</span></div>
      <div class="report-stat-row"><span class="label">日均专注</span><span class="value">${data.avgDaily} 分钟/天</span></div>
      <div class="report-stat-row"><span class="label">新学单词</span><span class="value">${data.weekNewWords} 个</span></div>
      <div class="report-stat-row"><span class="label">数学题目</span><span class="value">${data.weekMath} 道</span></div>
      <div class="report-stat-row"><span class="label">AI咨询</span><span class="value">${data.weekChats} 次</span></div>

      <h4><svg class="ico" viewBox="0 0 24 24"><path d="M4 20V10M9 20V4M14 20v-7M19 20v-11"/></svg> 每日专注时长分布</h4>
      <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:12px;padding:8px;background:var(--border-light);border-radius:8px;">
        ${data.dailyDist.map(d => {
          const h = Math.max(4, (d.minutes / maxMin) * 100);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:0.7rem;color:var(--text-secondary)">${d.minutes}m</span>
            <div style="width:100%;min-height:${h}%;background:var(--primary);border-radius:3px;min-height:4px"></div>
            <span style="font-size:0.65rem;color:var(--text-light)">${d.date.slice(5)}</span>
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
