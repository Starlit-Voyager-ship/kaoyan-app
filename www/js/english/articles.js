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
      item.innerHTML = `
        <h4>${a.title}</h4>
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

    // 渲染文章内容
    const contentEl = document.getElementById('reader-content');
    const paragraphs = article.content.split('\n').filter(p => p.trim());
    contentEl.innerHTML = paragraphs.map(p =>
      `<p style="margin-bottom:12px">${p}</p>`
    ).join('');
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
      this._renderTranslation();
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
      this._renderTranslation();
      Utils.toast('翻译完成');
    } catch (e) {
      console.error('[翻译失败]', e);
      Utils.toast((e && e.message) ? e.message : '翻译失败，请重试');
    }
  },

  _renderTranslation() {
    const contentEl = document.getElementById('reader-content');
    if (!contentEl || !this.currentArticle) return;
    const paragraphs = this.currentArticle.content.split('\n').filter(p => p.trim());
    if (!this._translationVisible || !this._rawTranslation) {
      contentEl.innerHTML = paragraphs.map(p => `<p style="margin-bottom:12px">${this._esc(p)}</p>`).join('');
      return;
    }
    const transParas = this._rawTranslation.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    let html = '';
    paragraphs.forEach((p, i) => {
      html += `<p style="margin-bottom:4px">${this._esc(p)}</p>`;
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
  },

  _esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  startQuiz() {
    if (!this.currentArticle) return;
    Utils.toast('阅读答题功能开发中...');
  }
};
