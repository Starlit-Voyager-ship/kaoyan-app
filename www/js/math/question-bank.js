/* ========================================
   数学题库模块 —— 书籍目录式三级结构
   书籍 → 知识点 / 年份 → 题目
   ======================================== */

/* 通用删除图标 + 删除确认弹窗（供数学/英语/薄弱等模块复用） */
window.TRASH_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>';
window.confirmDeleteItem = function (title, message, doDelete) {
  Utils.showModal(title, message, `
    <button class="btn-danger" id="cd-confirm-btn">确认删除</button>
    <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
  `);
  const btn = document.getElementById('cd-confirm-btn');
  if (btn) btn.onclick = async () => {
    try { await doDelete(); } catch (e) { console.error('[删除失败]', e); }
    Utils.hideModal();
    Utils.toast('已删除');
  };
};

/* —— 书籍目录 —— */
const MATH_BOOKS = [
  { id: 'jichu660',        name: '基础660',   type: 'kp'   },
  { id: 'jichu700',        name: '基础700题', type: 'kp'   },
  { id: 'yanxuan',         name: '严选题',     type: 'kp'   },
  { id: 'zhenjti_zhenshua', name: '真题真刷',   type: 'kp'   },
  { id: 'shuzhong_liti',   name: '书中例题',   type: 'kp'   },
  { id: 'linian_zhenti',   name: '历年真题',   type: 'year' }
];

const MATH_YEARS = [];
for (let y = 2010; y <= 2025; y++) MATH_YEARS.push(String(y));

/* 知识点分类（高数 + 线代），保留原 MATH_TOPICS 语义 */
const MATH_TOPICS = [
  {
    category: '高等数学',
    subs: ['函数、极限、连续', '一元函数微分学', '一元函数积分学', '多元函数微分学', '二重积分', '常微分方程']
  },
  {
    category: '线性代数',
    subs: ['行列式', '矩阵', '向量', '线性方程组', '特征值与特征向量', '二次型']
  }
];

function categoryOfKp(kp) {
  for (const g of MATH_TOPICS) if (g.subs.includes(kp)) return g.category;
  return '高等数学';
}

const UNFILED = '__unfiled__';

const MathBank = {
  path: { book: null, category: null, kp: null, year: null },

  init() {
    this.bindEvents();
    this.render();
  },

  bindEvents() {
    const addBtn = document.getElementById('math-add-btn');
    if (addBtn) addBtn.addEventListener('click', () => {
      app.navigate('ai-assistant');
      Utils.toast('请在AI助理中上传题目图片，并选择归属书籍进行录入');
    });
    const back = document.getElementById('question-back');
    if (back) back.addEventListener('click', () => this.backFromDetail());
  },

  async getAll() {
    const user = Store.getCurrentUser();
    return await Store.getUserData('math_questions', user) || [];
  },

  _matchesBook(q, b) {
    if (!b) return false;
    if (b.id === UNFILED) return !q.book;
    return q.book === b.id;
  },

  /* —— L1 书籍目录 —— */
  async renderBooks() {
    const all = await this.getAll();
    const counts = {};
    MATH_BOOKS.forEach(b => counts[b.id] = 0);
    let unfiled = 0;
    all.forEach(q => {
      if (q.book && counts[q.book] !== undefined) counts[q.book]++;
      else unfiled++;
    });

    let html = '<div class="bank-section-title">数学题库 · 书籍目录</div>';
    html += '<div class="bank-grid">';
    MATH_BOOKS.forEach(b => {
      const sub = b.type === 'year' ? '按年份（2010–2025）' : '按高数 / 线代知识点';
      html += `<div class="book-card" data-book="${b.id}">
        <div class="book-name">${b.name}</div>
        <div class="book-sub">${sub}</div>
        <div class="book-count">${counts[b.id]} 题</div>
      </div>`;
    });
    html += '</div>';

    if (unfiled > 0) {
      html += '<div class="bank-section-title">其他</div>';
      html += `<div class="bank-grid"><div class="book-card book-card--muted" data-book="${UNFILED}">
        <div class="book-name">未归档题目</div>
        <div class="book-sub">未指定书籍的录入题</div>
        <div class="book-count">${unfiled} 题</div>
      </div></div>`;
    }

    const view = document.getElementById('bank-view');
    view.innerHTML = html;
    view.querySelectorAll('.book-card').forEach(el => {
      el.addEventListener('click', () => this.enterBook(el.dataset.book));
    });
    this.renderBreadcrumb();
  },

  enterBook(bookId) {
    const book = bookId === UNFILED
      ? { id: UNFILED, name: '未归档题目', type: 'unfiled' }
      : MATH_BOOKS.find(b => b.id === bookId);
    this.path = { book, category: null, kp: null, year: null };
    this.render();
  },

  /* —— 路由 —— */
  async render() {
    const b = this.path.book;
    if (!b) { await this.renderBooks(); return; }
    if (b.type === 'year') {
      if (!this.path.year) { await this.renderYears(); return; }
    } else {
      if (!this.path.kp) { await this.renderKpSelection(); return; }
    }
    await this.renderQuestions();
  },

  /* —— L2：年份（历年真题） —— */
  async renderYears() {
    const all = await this.getAll();
    const counts = {};
    MATH_YEARS.forEach(y => counts[y] = 0);
    all.forEach(q => {
      if (this._matchesBook(q, this.path.book) && q.year && counts[q.year] !== undefined) counts[q.year]++;
    });

    let html = `<div class="bank-section-title">${this.path.book.name} · 按年份</div><div class="bank-grid">`;
    MATH_YEARS.forEach(y => {
      html += `<div class="year-card" data-year="${y}">
        <div class="year-num">${y}</div>
        <div class="year-count">${counts[y]} 题</div>
      </div>`;
    });
    html += '</div>';

    const view = document.getElementById('bank-view');
    view.innerHTML = html;
    view.querySelectorAll('.year-card').forEach(el => {
      el.addEventListener('click', () => { this.path.year = el.dataset.year; this.render(); });
    });
    this.renderBreadcrumb();
  },

  /* —— L2：知识点（其他书籍，按高数/线代分组） —— */
  async renderKpSelection() {
    const all = await this.getAll();
    const b = this.path.book;
    const counts = {};
    all.forEach(q => {
      if (!this._matchesBook(q, b)) return;
      const cat = q.category || categoryOfKp(q.knowledgePoint);
      const kp = q.knowledgePoint || q.topic || '其他';
      counts[cat + '||' + kp] = (counts[cat + '||' + kp] || 0) + 1;
    });

    let html = `<div class="bank-section-title">${b.name} · 按知识点</div>`;
    MATH_TOPICS.forEach(group => {
      html += `<div class="bank-cat-title">${group.category}</div><div class="bank-grid">`;
      group.subs.forEach(kp => {
        const n = counts[group.category + '||' + kp] || 0;
        html += `<div class="kp-card" data-cat="${group.category}" data-kp="${kp}">
          <div class="kp-name">${kp}</div>
          <div class="kp-count">${n} 题</div>
        </div>`;
      });
      html += '</div>';
    });

    const view = document.getElementById('bank-view');
    view.innerHTML = html;
    view.querySelectorAll('.kp-card').forEach(el => {
      el.addEventListener('click', () => {
        this.path.category = el.dataset.cat;
        this.path.kp = el.dataset.kp;
        this.render();
      });
    });
    this.renderBreadcrumb();
  },

  /* —— L3：题目列表 —— */
  async renderQuestions() {
    const all = await this.getAll();
    const b = this.path.book;
    const list = all.filter(q => {
      if (!this._matchesBook(q, b)) return false;
      if (b.type === 'year') return q.year === this.path.year;
      return (q.knowledgePoint || q.topic) === this.path.kp
        && (q.category || categoryOfKp(q.knowledgePoint)) === this.path.category;
    }).sort((a, c) => (c.createdAt || '').localeCompare(a.createdAt || ''));

    const view = document.getElementById('bank-view');
    if (!list.length) {
      view.innerHTML = '<div class="empty-hint">该分类下暂无题目，可通过AI助理上传图片录入</div>';
      this.renderBreadcrumb();
      return;
    }
    let html = '';
    list.forEach(q => {
      const kp = q.knowledgePoint || q.topic || (q.year ? q.year + '年' : '');
      const img = q.imageData
        ? '<svg class="ico" viewBox="0 0 24 24" style="width:15px;height:15px;vertical-align:-2px"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M8 6V4h8v2"/></svg>'
        : '';
      html += `<div class="question-item" data-id="${q.id}" style="position:relative;padding-right:44px">
        <div class="q-info">
          <div class="q-topic">${kp} ${img}</div>
          <div class="q-meta">${q.source || ''} · ${q.createdAt ? new Date(q.createdAt).toLocaleDateString() : ''}</div>
        </div>
        <button class="item-del-btn" title="删除此题目" aria-label="删除">${window.TRASH_SVG}</button>
      </div>`;
    });
    view.innerHTML = html;
    view.querySelectorAll('.question-item').forEach(el => {
      const q = list.find(x => x.id === el.dataset.id);
      if (!q) return;
      el.addEventListener('click', () => this.openDetail(q));
      const del = el.querySelector('.item-del-btn');
      if (del) del.addEventListener('click', (e) => {
        e.stopPropagation();
        window.confirmDeleteItem('删除题目', `确定删除「${q.knowledgePoint || q.topic || q.year || '该题目'}」吗？此操作不可撤销。`, async () => {
          await Store.delete('math_questions', q.id);
          this.renderQuestions();
        });
      });
    });
    this.renderBreadcrumb();
  },

  renderBreadcrumb() {
    const el = document.getElementById('bank-breadcrumb');
    if (!el) return;
    const p = this.path;
    let html = '<span class="crumb" data-crumb="root">题库</span>';
    if (p.book) {
      html += `<span class="crumb-sep">›</span><span class="crumb" data-crumb="book">${p.book.name}</span>`;
      if (p.book.type === 'year' && p.year) {
        html += `<span class="crumb-sep">›</span><span class="crumb">${p.year} 年</span>`;
      }
      if (p.kp) {
        html += `<span class="crumb-sep">›</span><span class="crumb">${p.category} · ${p.kp}</span>`;
      }
    }
    el.innerHTML = html;
    el.querySelectorAll('.crumb').forEach(c => {
      c.addEventListener('click', () => {
        const t = c.dataset.crumb;
        if (t === 'root') this.path = { book: null, category: null, kp: null, year: null };
        else if (t === 'book') { this.path.category = null; this.path.kp = null; this.path.year = null; }
        this.render();
      });
    });
  },

  backFromDetail() {
    document.getElementById('bank-view').style.display = '';
    const d = document.getElementById('question-detail');
    if (d) d.style.display = 'none';
  },

  openDetail(question) {
    document.getElementById('bank-view').style.display = 'none';
    const detail = document.getElementById('question-detail');
    if (detail) detail.style.display = 'block';

    const images = document.getElementById('detail-images');
    if (images) {
      images.innerHTML = '';
      if (question.imageData) {
        const arr = Array.isArray(question.imageData) ? question.imageData : [question.imageData];
        arr.forEach(src => {
          const img = document.createElement('img');
          img.src = src;
          img.onclick = () => window.open(src);
          images.appendChild(img);
        });
      }
    }

    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('detail-source', question.source || '-');
    set('detail-topic', (question.knowledgePoint || question.topic || (question.year ? question.year + '年' : '')) || '-');
    set('detail-error', question.errorReason || '-');
    set('detail-ocr', question.ocrText || '-');
    set('detail-time', question.createdAt ? new Date(question.createdAt).toLocaleString() : '-');

    const prevAi = document.getElementById('detail-ai');
    if (prevAi) prevAi.remove();
    if (question.aiResponse) {
      const aiDiv = document.createElement('div');
      aiDiv.id = 'detail-ai';
      aiDiv.style.cssText = 'margin-top:16px;padding:14px;background:var(--primary-bg);border-radius:8px;font-size:0.92rem;line-height:1.7';
      aiDiv.innerHTML = '<strong style="color:var(--primary)">AI解答：</strong><br>' + AIAssistant.formatContent(question.aiResponse);
      const info = document.querySelector('.detail-info');
      if (info) info.appendChild(aiDiv);
      if (typeof AIAssistant.renderMath === 'function') AIAssistant.renderMath(aiDiv);
    }
  }
};
