/* ========================================
   数学题库模块
   ======================================== */

const MATH_TOPICS = [
  {
    category: '高等数学',
    subs: [
      '函数、极限、连续',
      '一元函数微分学',
      '一元函数积分学',
      '多元函数微分学',
      '二重积分',
      '常微分方程'
    ]
  },
  {
    category: '线性代数',
    subs: [
      '行列式',
      '矩阵',
      '向量',
      '线性方程组',
      '特征值与特征向量',
      '二次型'
    ]
  }
];

const MathBank = {
  init() {
    this.renderTopicOptions();
    this.bindEvents();
    this.renderList();
  },

  renderTopicOptions() {
    const build = (id) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.innerHTML = '<option value="">全部知识点</option>';
      MATH_TOPICS.forEach(group => {
        const og = document.createElement('optgroup');
        og.label = group.category;
        group.subs.forEach(sub => {
          const opt = document.createElement('option');
          opt.value = sub;
          opt.textContent = sub;
          og.appendChild(opt);
        });
        sel.appendChild(og);
      });
    };
    build('math-topic-filter');
    build('upload-topic');
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
          <div class="q-topic">${q.topic} ${q.imageData ? '<svg class="ico" viewBox="0 0 24 24" style="width:15px;height:15px;vertical-align:-2px"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M8 6V4h8v2"/></svg>' : ''}</div>
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

    const prevAi = document.getElementById('detail-ai');
    if (prevAi) prevAi.remove();
    if (question.aiResponse) {
      const aiDiv = document.createElement('div');
      aiDiv.id = 'detail-ai';
      aiDiv.style.cssText = 'margin-top:16px;padding:14px;background:var(--primary-bg);border-radius:8px;font-size:0.92rem;line-height:1.7';
      aiDiv.innerHTML = '<strong style="color:var(--primary)">AI解答：</strong><br>' +
        AIAssistant.formatContent(question.aiResponse);
      document.getElementById('detail-info').appendChild(aiDiv);
      if (typeof AIAssistant.renderMath === 'function') AIAssistant.renderMath(aiDiv);
    }
  }
};
