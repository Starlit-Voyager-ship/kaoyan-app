/* ========================================
   作文模板模块
   ======================================== */

const EssayModule = {
  editingId: null,

  init() {
    if (!this._bound) {
      this.bindEvents();
      this._bound = true;
    }
    this.renderList();
  },

  bindEvents() {
    document.getElementById('add-essay-btn').addEventListener('click', () => this.showEditor());
    document.getElementById('essay-back').addEventListener('click', () => this.backToList());
    document.getElementById('essay-save').addEventListener('click', () => this.saveEssay());
    document.getElementById('essay-delete').addEventListener('click', () => this.deleteEssay());
  },

  async renderList() {
    const user = Store.getCurrentUser();
    const essays = await Store.getUserData('essays', user);
    const list = document.getElementById('essay-list');

    if (essays.length === 0) {
      list.innerHTML = '<div class="empty-hint">暂无内容，点击上方按钮添加</div>';
      return;
    }

    list.innerHTML = '';
    const typeLabels = { small: '小作文', big: '大作文', template: '模板', sample: '范文' };

    essays.forEach(e => {
      const item = document.createElement('div');
      item.className = 'essay-item';
      item.innerHTML = `
        <div>
          <span class="title">${Utils._escapeHtml(e.title)}</span>
          <span class="type-tag">${Utils._escapeHtml(typeLabels[e.type] || e.type)}</span>
        </div>
        <span style="color:var(--text-light);font-size:0.82rem">${new Date(e.createdAt).toLocaleDateString()}</span>
      `;
      item.addEventListener('click', () => this.editEssay(e));
      list.appendChild(item);
    });
  },

  backToList() {
    document.getElementById('essay-list').style.display = '';
    document.getElementById('essay-editor').style.display = 'none';
    this.editingId = null;
  },

  showEditor(essay = null) {
    document.getElementById('essay-list').style.display = 'none';
    document.getElementById('essay-editor').style.display = 'block';

    this.editingId = essay?.id || null;
    document.getElementById('essay-title-input').value = essay?.title || '';
    document.getElementById('essay-type-select').value = essay?.type || 'template';
    document.getElementById('essay-content-input').value = essay?.content || '';
    document.getElementById('essay-delete').style.display = essay ? 'inline-block' : 'none';
  },

  editEssay(essay) {
    this.showEditor(essay);
  },

  async saveEssay() {
    const title = document.getElementById('essay-title-input').value.trim();
    const type = document.getElementById('essay-type-select').value;
    const content = document.getElementById('essay-content-input').value.trim();

    if (!title || !content) {
      Utils.toast('请填写标题和内容');
      return;
    }

    const user = Store.getCurrentUser();

    if (this.editingId) {
      // 更新
      const essay = await Store.get('essays', this.editingId);
      if (essay && essay.username === user) {
        essay.title = title;
        essay.type = type;
        essay.content = content;
        essay.updatedAt = new Date().toISOString();
        await Store.put('essays', essay);
        Utils.toast('已更新');
      }
    } else {
      // 新建
      await Store.put('essays', {
        id: Utils.uid(),
        username: user,
        title,
        type,
        content,
        createdAt: new Date().toISOString()
      });
      Utils.toast('已保存');
    }

    this.backToList();
    this.renderList();
  },

  async deleteEssay() {
    if (!this.editingId) return;
    Utils.showModal('确认删除', '确定要删除这个模板/范文吗？此操作不可撤销。', `
      <button class="btn-danger" id="confirm-delete-essay">确认删除</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);
    document.getElementById('confirm-delete-essay').onclick = async () => {
      await Store.delete('essays', this.editingId);
      Utils.hideModal();
      Utils.toast('已删除');
      this.backToList();
      this.renderList();
    };
  }
};
