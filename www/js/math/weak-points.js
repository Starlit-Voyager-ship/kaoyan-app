/* ========================================
   数学薄弱错题模块
   ======================================== */

const WeakPoints = {
  init() {
    this.render();
  },

  async render() {
    const user = Store.getCurrentUser();
    const weakData = await Store.getUserData('math_weak_points', user);

    // 按知识点聚合统计
    const topicMap = {};
    weakData.forEach(w => {
      if (!topicMap[w.topic]) topicMap[w.topic] = { count: 0, items: [] };
      topicMap[w.topic].count += w.count || 1;
      topicMap[w.topic].items.push(w);
    });

    // 排序
    const sorted = Object.entries(topicMap)
      .sort((a, b) => b[1].count - a[1].count);

    // 渲染统计标签
    const statsEl = document.getElementById('weak-stats');
    if (sorted.length > 0) {
      statsEl.innerHTML = sorted.map(([topic, data]) =>
        `<span class="weak-stat-chip">${topic} (${data.count}次)</span>`
      ).join('');
    } else {
      statsEl.innerHTML = '';
    }

    // 渲染列表
    const list = document.getElementById('weak-list');
    if (sorted.length === 0) {
      list.innerHTML = '<div class="empty-hint">暂无薄弱点数据，多使用AI助理咨询数学问题吧</div>';
      return;
    }

    list.innerHTML = '';
    sorted.forEach(([topic, data]) => {
      const item = document.createElement('div');
      item.className = 'weak-item';
      item.innerHTML = `
        <div class="topic-name">${topic}</div>
        <div class="count">累计咨询 ${data.count} 次 · 最近 ${data.items[0]?.lastReview ?
          new Date(data.items[0].lastReview).toLocaleDateString() : '-'}</div>
      `;
      list.appendChild(item);
    });
  }
};
