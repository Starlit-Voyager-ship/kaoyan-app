/* ========================================
   数学薄弱错题模块
   - 按日期分组，每天内按知识点分类
   - 数据来源：AI助理咨询/上传归档数学题时自动写入 math_weak_points
   ======================================== */

const WeakPoints = {
  init() {
    this.render();
  },

  async render() {
    const user = Store.getCurrentUser();
    const weakData = await Store.getUserData('math_weak_points', user);

    if (!weakData || weakData.length === 0) {
      document.getElementById('weak-stats').innerHTML = '';
      document.getElementById('weak-list').innerHTML =
        '<div class="empty-hint">暂无薄弱点数据，多使用AI助理咨询数学问题吧</div>';
      return;
    }

    // 按日期分组
    const dateMap = {};
    weakData.forEach(w => {
      const d = w.date || (w.lastReview ? w.lastReview.slice(0, 10) : '未知日期');
      if (!dateMap[d]) dateMap[d] = { topics: {}, totalCount: 0 };
      dateMap[d].totalCount += w.count || 1;

      // 日期内按知识点聚合
      const t = w.topic || '未分类';
      if (!dateMap[d].topics[t]) dateMap[d].topics[t] = { count: 0, items: [], lastTime: '' };
      dateMap[d].topics[t].count += w.count || 1;
      dateMap[d].topics[t].items.push(w);
      if (w.lastReview && (!dateMap[d].topics[t].lastTime || w.lastReview > dateMap[d].topics[t].lastTime)) {
        dateMap[d].topics[t].lastTime = w.lastReview;
      }
    });

    // 日期倒序（最近在前）
    const sortedDates = Object.entries(dateMap).sort((a, b) => b[0].localeCompare(a[0]));

    // 顶部统计概览
    const statsEl = document.getElementById('weak-stats');
    const totalRecords = weakData.length;
    const totalDays = sortedDates.length;
    const topicSet = new Set();
    weakData.forEach(w => topicSet.add(w.topic || '未分类'));
    statsEl.innerHTML = `
      <span class="weak-stat-chip">共 ${totalRecords} 条记录</span>
      <span class="weak-stat-chip">${totalDays} 个学习日</span>
      <span class="weak-stat-chip">${topicSet.size} 个知识点</span>
    `;

    // 渲染列表（按日期 > 知识点）
    const list = document.getElementById('weak-list');
    list.innerHTML = '';

    sortedDates.forEach(([dateStr, dayData]) => {
      // 日期标题行
      const dayEl = document.createElement('div');
      dayEl.className = 'weak-day-group';

      // 格式化日期显示
      let dateLabel = dateStr;
      if (dateStr !== '未知日期') {
        try {
          const d = new Date(dateStr + 'T00:00:00');
          const today = new Date(); today.setHours(0,0,0,0);
          const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
          if (d.getTime() === today.getTime()) dateLabel = '今天';
          else if (d.getTime() === yesterday.getTime()) dateLabel = '昨天';
          else dateLabel = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
        } catch (_) {}
      }

      // 该日期下的知识点（按次数降序）
      const sortedTopics = Object.entries(dayData.topics)
        .sort((a, b) => b[1].count - a[1].count);

      dayEl.innerHTML = `
        <div class="weak-day-header">
          <span class="weak-day-title">${dateLabel}</span>
          <span class="weak-day-count">共 ${dayData.totalCount} 次 · ${sortedTopics.length} 个知识点</span>
        </div>
        <div class="weak-day-topics">
          ${sortedTopics.map(([topic, tData]) => `
            <div class="weak-topic-item">
              <div class="topic-name">${topic}</div>
              <div class="topic-meta">咨询 ${tData.count} 次${tData.lastTime ? ' · 最近 ' + new Date(tData.lastTime).toLocaleTimeString().slice(0,5) : ''}</div>
            </div>
          `).join('')}
        </div>
      `;

      list.appendChild(dayEl);
    });
  }
};
