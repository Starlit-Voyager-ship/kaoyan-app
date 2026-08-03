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
    const contentEl = document.getElementById('reader-content');
    if (!contentEl) return;
    // 已翻译则切换显隐
    if (this._translated) {
      this._translationVisible = !this._translationVisible;
      this.renderReaderContent();
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
      Utils.toast('翻译完成');
    } catch (e) {
      console.error('[翻译失败]', e);
      Utils.toast((e && e.message) ? e.message : '翻译失败，请重试');
    }
  },

  /* ---------- 点词翻译：开启后单词可点击，点击显示释义并加入单词本 ---------- */
  async toggleDict() {
    if (!this.currentArticle) return;
    this._dictMode = !this._dictMode;
    const btn = document.getElementById('reader-dict');
    if (btn) btn.classList.toggle('on', this._dictMode);

    if (this._dictMode) {
      const settings = Store.getSettings(Store.getCurrentUser()) || {};
      if (!settings.qwenKey) {
        Utils.toast('请先在设置中配置千问 Key');
        this._dictMode = false;
        if (btn) btn.classList.remove('on');
        return;
      }
      Utils.toast('正在生成点词词典…');
      try {
        this._wordDict = await this.buildWordDict(settings);
        Utils.toast('点词词典已就绪（' + Object.keys(this._wordDict).length + ' 词）');
      } catch (e) {
        console.error('[点词词典生成失败]', e);
        Utils.toast('词典生成失败，可点击单词单独查询');
        this._wordDict = {};
      }
    }
    this.renderReaderContent();
  },

  // 提取文章全部唯一单词，调用千问一次性返回 { word: "词性 释义" } 词典
  async buildWordDict(settings) {
    const text = (this.currentArticle.content || '').toLowerCase();
    const set = new Set();
    const re = /[a-z][a-z']*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length > 1) set.add(m[0]);
    }
    const list = Array.from(set);
    if (!list.length) return {};
    const prompt = '你是考研英语词典。请返回一个 JSON 对象：键为下列英文单词（保持原拼写），值为该词的中文释义（必须含词性，格式如 "v. 放弃；抛弃" 或 "n. 能力"）。不要任何解释、不要额外文字，只返回 JSON。\n单词列表：\n' + list.join(', ');
    const raw = await AIAssistant.callQwenChat(settings,
      [{ role: 'system', content: '你是一个严谨的英汉词典 API，只返回 JSON 对象，不要任何额外文字。' },
       { role: 'user', content: prompt }],
      '千问点词词典', { maxTokens: 6000 });
    try {
      const m2 = raw.match(/\{[\s\S]*\}/);
      return m2 ? JSON.parse(m2[0]) : {};
    } catch (e) {
      console.warn('[词典解析失败]', e);
      return {};
    }
  },

  // 点击单词：显示词性+释义，并加入单词背诵表
  async onWordClick(sp) {
    const raw = sp.dataset.w;
    const word = raw.toLowerCase().replace(/[^a-z']/g, '');
    if (!word) return;
    if (sp.dataset.shown === '1') return; // 已显示则不再重复

    let meaning = this._wordDict ? this._wordDict[word] : null;
    if (!meaning) {
      // 词典未覆盖，单独查询该词
      const settings = Store.getSettings(Store.getCurrentUser()) || {};
      if (settings.qwenKey) {
        try {
          Utils.toast('查询：' + raw);
          const r = await AIAssistant.callQwenChat(settings,
            [{ role: 'system', content: '你是英汉词典。只返回该英文单词的中文释义，含词性，格式如 "v. 放弃；抛弃"。不要解释。' },
             { role: 'user', content: raw }],
            '千问单词查询', { maxTokens: 200 });
          meaning = r.replace(/^["'\{\}]+|["'\{\}]+$/g, '').trim();
        } catch (e) { console.warn(e); }
      }
    }
    if (!meaning) { Utils.toast('翻译失败：' + raw); return; }

    // 在单词后插入释义
    const anno = document.createElement('span');
    anno.className = 'word-anno';
    anno.textContent = ' ' + meaning;
    sp.insertAdjacentElement('afterend', anno);
    sp.dataset.shown = '1';
    sp.classList.add('tword-done');

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
      if (this._dictMode) {
        const toks = this._tokenize(p);
        const inner = toks.map(t => t.isWord
          ? `<span class="tword" data-w="${this._esc(t.word)}">${this._esc(t.word)}</span>`
          : this._esc(t.text)).join('');
        html += `<p class="dict-p" style="margin-bottom:4px">${inner}</p>`;
      } else {
        html += `<p style="margin-bottom:4px">${this._esc(p)}</p>`;
      }
      const t = transParas[i];
      if (t) {
        html += `<p class="reader-translation" style="margin-bottom:12px;color:var(--text-light);line-height:1.6">${this._esc(t)}</p>`;
      }
    });
    if (transParas.length > paragraphs.length) {
      transParas.slice(paragraphs.length).forEach(t => {
        html += `<p class="reader-translation" style="margin-bottom:12px;color:var(--text-light)">${this._esc(t)}</p>`;
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
