/* ========================================
   数学题库模块
   ======================================== */

const MathBank = {
  init() {
    this.bindEvents();
    this.renderList();
  },

  bindEvents() {
    document.getElementById('math-add-btn').addEventListener('click', () => {
      app.navigate('ai-assistant');
      Utils.toast('请在AI助理中上传题目图片进行录入');
    });
    document.getElementById('question-back').addEventListener('click', () => this.backToList());

    document.getElementById('math-source-filter').addEventListener('change', () => this.renderList());
    document.getElementById('math-topic-filter').addEventListener('change', () => this.renderList());
  },

  async renderList() {
    const user = Store.getCurrentUser();
    let questions = await Store.getUserData('math_questions', user);

    // 筛选
    const sourceFilter = document.getElementById('math-source-filter').value;
    const topicFilter = document.getElementById('math-topic-filter').value;

    if (sourceFilter) questions = questions.filter(q => q.source === sourceFilter);
    if (topicFilter) questions = questions.filter(q => q.topic === topicFilter);

    // 按时间倒序
    questions.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    const list = document.getElementById('math-question-list');

    if (questions.length === 0) {
      list.innerHTML = '<div class="empty-hint">暂无题目，可通过AI助理上传图片录入</div>';
      return;
    }

    list.innerHTML = '';
    questions.forEach(q => {
      const item = document.createElement('div');
      item.className = 'question-item';
      item.innerHTML = `
        <div class="q-info">
          <div class="q-topic">${q.topic} ${q.imageData ? '📷' : ''}</div>
          <div class="q-meta">${q.source} · ${q.createdAt ? new Date(q.createdAt).toLocaleDateString() : ''}</div>
        </div>
        <div class="q-tags">
          <span class="q-tag">${q.topic}</span>
        </div>
      `;
      item.addEventListener('click', () => this.openDetail(q));
      list.appendChild(item);
    });
  },

  backToList() {
    document.getElementById('math-question-list').style.display = '';
    document.getElementById('question-detail').style.display = 'none';
  },

  openDetail(question) {
    document.getElementById('math-question-list').style.display = 'none';
    document.getElementById('question-detail').style.display = 'block';

    const images = document.getElementById('detail-images');
    images.innerHTML = '';
    if (question.imageData) {
      const img = document.createElement('img');
      img.src = question.imageData;
      images.appendChild(img);
    }

    document.getElementById('detail-source').textContent = question.source || '-';
    document.getElementById('detail-topic').textContent = question.topic || '-';
    document.getElementById('detail-error').textContent = question.errorReason || '-';
    document.getElementById('detail-ocr').textContent = question.ocrText || '-';
    document.getElementById('detail-time').textContent =
      question.createdAt ? new Date(question.createdAt).toLocaleString() : '-';

    if (question.aiResponse) {
      const aiDiv = document.createElement('div');
      aiDiv.style.cssText = 'margin-top:16px;padding:14px;background:var(--primary-bg);border-radius:8px;font-size:0.92rem;line-height:1.7';
      aiDiv.innerHTML = '<strong style="color:var(--primary)">AI解答：</strong><br>' +
        question.aiResponse.replace(/\n/g, '<br>');
      document.getElementById('detail-info').appendChild(aiDiv);
    }
  }
};
