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

  translateAll() {
    if (!this.currentArticle) return;
    // 调用DeepSeek翻译（如果配置了的话）
    const settings = Store.getSettings(Store.getCurrentUser()) || {};
    if (!settings.deepseekKey) {
      Utils.toast('请先在设置中配置 DeepSeek API Key 以使用翻译功能');
      return;
    }
    Utils.toast('正在翻译全文...');
    // 实际翻译逻辑在AI调用中处理，这里做简单标记
    this.markTranslatedWords();
  },

  markTranslatedWords() {
    const content = document.getElementById('reader-content');
    const text = content.textContent;
    // 简单分词并标记（实际应调API）
    const words = text.match(/[a-zA-Z]+/g) || [];
    const uniqueWords = [...new Set(words)].slice(0, 20);

    let html = this.currentArticle.content;
    uniqueWords.forEach(w => {
      html = html.replace(new RegExp(`\\b${w}\\b`, 'g'),
        `<span class="highlight-word">${w}</span>`);
    });
    content.innerHTML = html.split('\n').filter(p => p.trim())
      .map(p => `<p style="margin-bottom:12px">${p}</p>`).join('');
  },

  startQuiz() {
    if (!this.currentArticle) return;
    Utils.toast('阅读答题功能开发中...');
  }
};
