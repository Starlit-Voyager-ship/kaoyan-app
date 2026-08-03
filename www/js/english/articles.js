/* ========================================
   文章阅读模块
   ======================================== */

const Articles = {
  currentArticle: null,

  init() {
    this.bindEvents();
    this.renderList();
  },

  bindEvents() {
    document.getElementById('add-article-btn').addEventListener('click', () => this.showEditor());
    document.getElementById('article-back').addEventListener('click', () => this.backToList());
    document.getElementById('reader-translate-all').addEventListener('click', () => this.translateAll());
    document.getElementById('reader-quiz').addEventListener('click', () => this.startQuiz());
    document.getElementById('reader-mark-wrong').addEventListener('click', () => this.scrollToAI());
    document.getElementById('reader-dict').addEventListener('click', () => this.toggleDict());
  },

  async renderList() {
    const user = Store.getCurrentUser();
    const articles = await Store.getUserData('articles', user);
    const list = document.getElementById('article-list');
    const empty = document.getElementById('articles-empty');

    if (articles.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    list.style.display = 'flex';
    list.innerHTML = '';

    articles.forEach(a => {
      const item = document.createElement('div');
      item.className = 'article-item';
      const wrongN = (a.wrongQuestions && a.wrongQuestions.length) ? a.wrongQuestions.length : 0;
      item.innerHTML = `
        <h4>${a.title}${wrongN ? ` <span class="wrong-badge">${wrongN} 错</span>` : ''}</h4>
        <p>${a.content.substring(0, 80)}...</p>
        <small style="color:var(--text-light)">${new Date(a.createdAt).toLocaleDateString()}</small>
      `;
      item.addEventListener('click', () => this.openArticle(a));
      list.appendChild(item);
    });
  },

  backToList() {
    document.getElementById('article-list').style.display = '';
    document.getElementById('articles-empty').style.display =
      (document.getElementById('article-list').children.length === 0) ? 'block' : 'none';
    document.getElementById('article-reader').style.display = 'none';
  },

  async openArticle(article) {
    this.currentArticle = article;
    this._translated = false;
    this._translationVisible = false;
    this._rawTranslation = null;
    document.getElementById('article-list').style.display = 'none';
    document.getElementById('articles-empty').style.display = 'none';
    document.getElementById('article-reader').style.display = 'block';

    document.getElementById('reader-title').textContent = article.title;

    // 重置点词翻译状态
    this._dictMode = false;
    this._wordDict = {};
    this._shownWords = {};
    const dictBtn = document.getElementById('reader-dict');
    if (dictBtn) dictBtn.classList.remove('on');

    // 渲染文章内容（兼容 点词翻译 / 全文翻译 两种视图）
    this.renderReaderContent();

    // 渲染 AI 解析与错题标注
    this.renderReaderAI();
  },

  scrollToAI() {
    const box = document.getElementById('reader-ai');
    if (box && box.style.display !== 'none') {
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      Utils.toast('本文暂无 AI 解析，上传时含题目即可自动生成');
    }
  },

  renderReaderAI() {
    const box = document.getElementById('reader-ai');
    if (!box) return;
    const art = this.currentArticle;
    const raw = art && art.aiResponse;
    if (!raw) { box.innerHTML = ''; box.style.display = 'none'; return; }

    let data;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      data = JSON.parse(m ? m[0] : raw);
    } catch (e) { data = { summary: raw, questions: [] }; }

    const wrong = Array.isArray(art.wrongQuestions) ? art.wrongQuestions : [];
    let html = '<div class="reader-ai-card">';
    html += '<h4>AI 阅读解析</h4>';
    if (data.summary) html += `<div class="ai-summary">${this._esc(data.summary)}</div>`;
    if (data.questions && data.questions.length) {
      html += '<div class="ai-questions">';
      data.questions.forEach((q, i) => {
        const isWrong = wrong.indexOf(i) !== -1;
        html += `<div class="ai-q ${isWrong ? 'wrong' : ''}" data-idx="${i}">
          <div class="ai-q-head">
            <span class="ai-q-no">${this._esc(q.no || ('第' + (i + 1) + '题'))}</span>
            <button type="button" class="ai-q-toggle ${isWrong ? 'on' : ''}" data-idx="${i}">${isWrong ? '✓ 我答错了' : '标记错题'}</button>
          </div>
          ${q.question ? `<div class="ai-q-text">${this._esc(q.question)}</div>` : ''}
          ${q.answer ? `<div class="ai-q-ans"><b>答案：</b>${this._esc(q.answer)}</div>` : ''}
          ${q.explanation ? `<div class="ai-q-exp">${this._esc(q.explanation)}</div>` : ''}
        </div>`;
      });
      html += '</div>';
    }
    html += '</div>';
    box.innerHTML = html;
    box.style.display = 'block';

    box.querySelectorAll('.ai-q-toggle').forEach(btn => {
      btn.addEventListener('click', () => this.toggleWrong(parseInt(btn.dataset.idx, 10)));
    });
  },

  async toggleWrong(idx) {
    const art = this.currentArticle;
    if (!art) return;
    const wrong = Array.isArray(art.wrongQuestions) ? art.wrongQuestions.slice() : [];
    const pos = wrong.indexOf(idx);
    if (pos === -1) wrong.push(idx); else wrong.splice(pos, 1);
    art.wrongQuestions = wrong;
    // 持久化到本地缓存 + 云端
    await Store.put('articles', Object.assign({}, art));
    this.renderReaderAI();
    const n = wrong.length;
    Utils.toast(n ? ('已标记 ' + n + ' 道错题') : '已清除错题标记');
  },

  showEditor() {
    Utils.showModal('添加文章', `
      <div class="input-group">
        <label>标题</label>
        <input type="text" id="modal-article-title" placeholder="文章标题" class="setting-input">
      </div>
      <div class="input-group">
        <label>正文内容</label>
        <textarea id="modal-article-content" rows="10" placeholder="粘贴或输入英文文章内容..." class="setting-input"></textarea>
      </div>
    `, `<button class="btn-primary" id="save-article-btn">保存</button>
       <button class="btn-outline" onclick="Utils.hideModal()">取消</button>`);

    document.getElementById('save-article-btn').onclick = () => this.saveFromModal();
  },

  async saveFromModal() {
    const title = document.getElementById('modal-article-title').value.trim();
    const content = document.getElementById('modal-article-content').value.trim();

    if (!title || !content) {
      Utils.toast('请填写完整信息');
      return;
    }

    const user = Store.getCurrentUser();
    await Store.put('articles', {
      id: Utils.uid(),
      username: user,
      title,
      content,
      wrongQuestions: [],
      aiResponse: '',
      createdAt: new Date().toISOString()
    });

    Utils.hideModal();
    Utils.toast('文章已保存');
    this.renderList();

    // 加金币：每篇文章+10金币
    await Store.addCoins(user, 10);
    app.updateHomeStats();
  },

  async translateAll() {
    const btn = document.getElementById('reader-translate-all');
    // 已翻译过：在「展开 / 收起」之间切换，可随时收回
    if (this._translated) {
      this._translationVisible = !this._translationVisible;
      this.renderReaderContent();
      if (btn) btn.textContent = this._translationVisible ? '收起翻译' : '全文翻译';
      return;
    }
    if (!this.currentArticle) return;
    const settings = Store.getSettings(Store.getCurrentUser()) || {};
    if (!settings.qwenKey) {
      Utils.toast('请先在设置中配置千问 Key 以使用翻译功能');
      return;
    }
    Utils.toast('正在调用千问翻译全文...');
    try {
      const english = this.currentArticle.content.trim();
      const translation = await AIAssistant.callQwenChat(settings, [
        { role: 'system', content: '你是严谨的考研英语翻译专家。请将用户提供的英文文章逐段翻译成中文，保持原有段落划分：每段英文对应一段中文，段间用空行分隔。只输出译文，不要解释、不要序号、不要额外标记。' },
        { role: 'user', content: english }
      ], '千问翻译');
      this._rawTranslation = translation;
      this._translated = true;
      this._translationVisible = true;
      this.renderReaderContent();
      if (btn) btn.textContent = '收起翻译';
      Utils.toast('翻译完成');
    } catch (e) {
      console.error('[翻译失败]', e);
      Utils.toast((e && e.message) ? e.message : '翻译失败，请重试');
    }
  },

  /* ---------- 点词翻译：本地内置词典即时模式（无需 API，零等待） ---------- */
  async toggleDict() {
    if (!this.currentArticle) return;
    this._dictMode = !this._dictMode;
    const btn = document.getElementById('reader-dict');
    if (btn) btn.classList.toggle('on', this._dictMode);
    if (this._dictMode) {
      const dictSize = window.EN_DICT ? Object.keys(window.EN_DICT).length : 0;
      Utils.toast('点词翻译已开启（内置词典 ' + dictSize + ' 词，点词即显；未收录词自动查 AI）');
    }
    this.renderReaderContent();
  },

  // 点击单词：本地词典命中即瞬时显示，未命中再回退 AI 查询；并加入单词背诵表
  async onWordClick(sp) {
    const raw = sp.dataset.w;
    const word = raw.toLowerCase().replace(/[^a-z']/g, '');
    if (!word) return;
    if (sp.dataset.shown === '1') return; // 已显示则不再重复

    // 1) 本地词典优先：瞬时取义
    let meaning = (window.EN_DICT && window.EN_DICT[word]) || null;

    // 2) 未命中 → 回退 AI 单独查询该词
    if (!meaning) {
      const settings = Store.getSettings(Store.getCurrentUser()) || {};
      if (settings.qwenKey) {
        try {
          Utils.toast('本地未收录，查询：' + raw);
          const r = await AIAssistant.callQwenChat(settings,
            [{ role: 'system', content: '你是英汉词典。只返回该英文单词的中文释义，含词性，格式如 "v. 放弃；抛弃"。不要解释。' },
             { role: 'user', content: raw }],
            '千问单词查询', { maxTokens: 200 });
          meaning = r.replace(/^["'\{\}]+|["'\{\}]+$/g, '').trim();
        } catch (e) { console.warn(e); }
      }
    }
    if (!meaning) { Utils.toast('未找到释义：' + raw); return; }

    // 在单词后插入释义：word（释义）
    const anno = document.createElement('span');
    anno.className = 'word-anno';
    anno.textContent = '（' + meaning + '）';
    sp.insertAdjacentElement('afterend', anno);
    sp.dataset.shown = '1';
    sp.classList.add('tword-done');

    // 记录已显示，便于重新渲染（如切换全文翻译）时保留
    if (!this._shownWords) this._shownWords = {};
    this._shownWords[word] = meaning;

    // 加入单词背诵模块
    if (window.Vocabulary) await Vocabulary.addWord(word, meaning);
  },

  // 把段落拆成「单词 / 非单词」片段
  _tokenize(text) {
    const re = /([A-Za-z][A-Za-z']*)/g;
    const toks = [];
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) toks.push({ isWord: false, text: text.slice(last, m.index) });
      toks.push({ isWord: true, word: m[0] });
      last = m.index + m[0].length;
    }
    if (last < text.length) toks.push({ isWord: false, text: text.slice(last) });
    return toks;
  },

  // 统一渲染阅读内容：兼容「点词翻译」与「全文翻译」两种视图
  // 每段用 .reader-para 容器包裹（英文段 + 可选中文段），保证段落严格对应、排版整齐
  renderReaderContent() {
    const contentEl = document.getElementById('reader-content');
    if (!contentEl || !this.currentArticle) return;
    const paragraphs = (this.currentArticle.content || '').split('\n').filter(p => p.trim());
    if (!paragraphs.length) { contentEl.innerHTML = ''; return; }

    const transParas = (this._translationVisible && this._rawTranslation)
      ? this._rawTranslation.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean)
      : [];

    let html = '';
    paragraphs.forEach((p, i) => {
      let inner;
      if (this._dictMode) {
        const toks = this._tokenize(p);
        inner = toks.map(t => {
          if (!t.isWord) return this._esc(t.text);
          const w = t.word.toLowerCase().replace(/[^a-z']/g, '');
          const shown = this._shownWords && this._shownWords[w];
          if (shown) {
            return `<span class="tword tword-done" data-w="${this._esc(t.word)}">${this._esc(t.word)}</span><span class="word-anno">（${this._esc(shown)}）</span>`;
          }
          return `<span class="tword" data-w="${this._esc(t.word)}">${this._esc(t.word)}</span>`;
        }).join('');
      } else {
        inner = this._esc(p);
      }
      html += '<div class="reader-para">';
      html += `<p class="reader-en" style="margin-bottom:${this._translationVisible ? '2px' : '12px'}">${inner}</p>`;
      const t = transParas[i];
      if (t) {
        html += `<p class="reader-translation">${this._esc(t)}</p>`;
      }
      html += '</div>';
    });
    // 翻译段多于原文段时（AI 多拆出段落），补在末尾
    if (transParas.length > paragraphs.length) {
      transParas.slice(paragraphs.length).forEach(t => {
        html += `<div class="reader-para"><p class="reader-translation">${this._esc(t)}</p></div>`;
      });
    }
    contentEl.innerHTML = html;

    if (this._dictMode) {
      contentEl.querySelectorAll('.tword').forEach(sp => {
        sp.addEventListener('click', () => this.onWordClick(sp));
      });
    }
  },

  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  startQuiz() {
    if (!this.currentArticle) return;
    Utils.toast('阅读答题功能开发中...');
  }
};
