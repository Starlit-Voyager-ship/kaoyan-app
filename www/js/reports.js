/* ========================================
   学习数据报表模块（日报/周报）
   ======================================== */

const Reports = {
  init() {
    this.bindEvents();
  },

  bindEvents() {
    document.querySelectorAll('.report-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('report-' + tab.dataset.report).classList.add('active');
      });
    });

    document.getElementById('generate-daily').addEventListener('click', () => this.generateDaily());
    document.getElementById('generate-weekly').addEventListener('click', () => this.generateWeekly());
  },

  async generateDaily() {
    const user = Store.getCurrentUser();
    const today = Utils.today();

    // 收集今日数据
    const focusRecords = await Store.getUserData('pomodoro_records', user);
    const todayFocus = focusRecords.filter(r => r.date === today && r.completed);
    const totalMinutes = todayFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = todayFocus.length;

    const words = await Store.getUserData('vocab_words', user);
    const todayWords = words.filter(w => w.firstLearned === today).length;
    const wrongWords = words.filter(w => w.isWrong && w.lastReview === today).length;

    const questions = await Store.getUserData('math_questions', user);
    const todayMath = questions.filter(q => q.createdAt && q.createdAt.startsWith(today)).length;

    const chats = await Store.getUserData('ai_chats', user);
    const todayChats = chats.filter(c => c.timestamp && c.timestamp.startsWith(today)).length;

    const petData = await Store.getPetData(user);
    const coinsToday = petData?.totalCoinsEarned || 0;

    // 生成报告HTML
    const reportEl = document.getElementById('daily-report-content');
    reportEl.innerHTML = `
      <h4>📅 ${today} 学习日报</h4>
      <div class="report-stat-row"><span class="label">专注时长</span><span class="value">${totalMinutes} 分钟 (${sessions}个番茄)</span></div>
      <div class="report-stat-row"><span class="label">新背单词</span><span class="value">${todayWords} 个</span></div>
      <div class="report-stat-row"><span class="label">错词复习</span><span class="value">${wrongWords} 个</span></div>
      <div class="report-stat-row"><span class="label">数学录题</span><span class="value">${todayMath} 道</span></div>
      <div class="report-stat-row"><span class="label">AI咨询次数</span><span class="value">${todayChats} 次</span></div>
      <div class="report-stat-row"><span class="label">累计金币</span><span class="value">${petData?.coins || 0} 🪙</span></div>
      <h4>💡 AI学习建议</h4>
      <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.8">
        ${this.generateSuggestion({ totalMinutes, sessions, todayWords, wrongWords, todayMath, todayChats })}
      </p>
    `;

    // 缓存报告
    await Store.put('reports', {
      id: `daily_${user}_${today}`,
      username: user,
      type: 'daily',
      date: today,
      data: { totalMinutes, sessions, todayWords, wrongWords, todayMath, todayChats },
      generatedAt: new Date().toISOString()
    });

    Utils.toast('日报已生成！');
  },

  async generateWeekly() {
    const user = Store.getCurrentUser();
    const week = Utils.thisWeek();

    // 收集本周数据
    const focusRecords = await Store.getUserData('pomodoro_records', user);
    const weekFocus = focusRecords.filter(r => r.date >= week.start && r.date <= week.end && r.completed);
    const totalMinutes = weekFocus.reduce((s, r) => s + (r.duration || 0), 0);
    const sessions = weekFocus.length;

    const words = await Store.getUserData('vocab_words', user);
    const weekNewWords = words.filter(w => w.firstLearned >= week.start && w.firstLearned <= week.end).length;

    const questions = await Store.getUserData('math_questions', user);
    const weekMath = questions.filter(q => q.createdAt >= week.start && q.createdAt <= week.end).length;

    const chats = await Store.getUserData('ai_chats', user);
    const weekChats = chats.filter(c => c.timestamp >= week.start && c.timestamp <= week.end).length;

    // 每日分布
    const dailyDist = [];
    for (let d = new Date(week.start); d <= new Date(week.end); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const dayMin = weekFocus.filter(r => r.date === dateStr).reduce((s, r) => s + (r.duration || 0), 0);
      dailyDist.push({ date: dateStr, minutes: dayMin });
    }

    const avgDaily = Math.round(totalMinutes / 7);

    const reportEl = document.getElementById('weekly-report-content');
    reportEl.innerHTML = `
      <h4>📈 ${week.start} ~ ${week.end} ���度学习报告</h4>
      <div class="report-stat-row"><span class="label">总专注时长</span><span class="value">${totalMinutes} 分钟 (${sessions}个番茄)</span></div>
      <div class="report-stat-row"><span class="label">日均专注</span><span class="value">${avgDaily} 分钟/天</span></div>
      <div class="report-stat-row"><span class="label">新学单词</span><span class="value">${weekNewWords} 个</span></div>
      <div class="report-stat-row"><span class="label">数学题目</span><span class="value">${weekMath} 道</span></div>
      <div class="report-stat-row"><span class="label">AI咨询</span><span class="value">${weekChats} 次</span></div>

      <h4>📊 每日专注时长分布</h4>
      <div style="display:flex;align-items:flex-end;gap:6px;height:120px;margin-top:12px;padding:8px;background:var(--border-light);border-radius:8px;">
        ${dailyDist.map(d => {
          const h = Math.max(4, (d.minutes / Math.max(...dailyDist.map(x => x.minutes), 1)) * 100);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:0.7rem;color:var(--text-secondary)">${d.minutes}m</span>
            <div style="width:100%;min-height:${h}%;background:linear-gradient(to top,var(--primary),var(--primary-light));border-radius:3px;min-height:4px"></div>
            <span style="font-size:0.65rem;color:var(--text-light)">${d.date.slice(5)}</span>
          </div>`;
        }).join('')}
      </div>

      <h4>💡 周度总结与建议</h4>
      <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.8;margin-top:8px">
        ${this.generateWeeklySuggestion({ totalMinutes, avgDaily, sessions, weekNewWords, weekMath, weekChats })}
      </p>
    `;

    await Store.put('reports', {
      id: `weekly_${user}_${week.start}`,
      username: user,
      type: 'weekly',
      weekStart: week.start,
      weekEnd: week.end,
      data: { totalMinutes, sessions, weekNewWords, weekMath, weekChats },
      generatedAt: new Date().toISOString()
    });

    Utils.toast('周报已生成！');
  },

  generateSuggestion(data) {
    const suggestions = [];

    if (data.totalMinutes < 60) suggestions.push('今天专注时长偏少，建议至少完成2-3个番茄钟（50-75分钟）的有效学习。');
    if (data.totalMinutes >= 120) suggestions.push('今天的专注时长很棒！保持这个节奏，注意适当休息。');
    if (data.todayWords < 5) suggestions.push('单词背诵量偏低，建议每天至少新学15-20个单词。');
    if (data.wrongWords > 5) suggestions.push(`错词数量较多(${data.wrongWords}个)，建议重点回顾错词本，加强记忆。`);
    if (data.todayMath === 0) suggestions.push('今天还没有录入数学题目，遇到不会的题记得用AI助理拍照录入。`);
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

    const dayNames = ['周一','周二','周三','周四','周五','周六','周日'];
    suggestions.push('坚持就是胜利，每周的积累都会在考场上体现出来！💪');

    return suggestions.join('<br><br>');
  }
};
