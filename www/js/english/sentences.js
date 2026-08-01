/* ========================================
   长难句解析模块
   ======================================== */

const Sentences = {
  init() {
    this.bindEvents();
    this.renderList();
  },

  bindEvents() {
    document.getElementById('add-sentence-btn').addEventListener('click', () => this.showAddModal());
    document.getElementById('sentence-back').addEventListener('click', () => this.backToList());
  },

  async renderList() {
    const user = Store.getCurrentUser();
    const sentences = await Store.getUserData('sentences', user);
    const list = document.getElementById('sentence-list');
    const empty = document.getElementById('sentences-empty');

    if (sentences.length === 0) {
      list.style.display = 'none';
      empty.style.display = 'block';
      return;
    }

    empty.style.display = 'none';
    list.style.display = 'flex';
    list.innerHTML = '';

    sentences.forEach(s => {
      const item = document.createElement('div');
      item.className = 'sentence-item';
      item.innerHTML = `<span class="sentence-original-text">${s.original}</span>`;
      item.addEventListener('click', () => this.openDetail(s));
      list.appendChild(item);
    });
  },

  backToList() {
    document.getElementById('sentence-list').style.display = '';
    document.getElementById('sentences-empty').style.display =
      (document.getElementById('sentence-list').children.length === 0) ? 'block' : 'none';
    document.getElementById('sentence-detail').style.display = 'none';
  },

  openDetail(sentence) {
    document.getElementById('sentence-list').style.display = 'none';
    document.getElementById('sentences-empty').style.display = 'none';
    document.getElementById('sentence-detail').style.display = 'block';

    document.getElementById('sentence-original').textContent = sentence.original;

    const analysis = document.getElementById('sentence-analysis');
    if (sentence.analysis) {
      analysis.innerHTML = `
        <div class="analysis-part"><h5>📌 句法结构</h5><p>${sentence.analysis.structure || '分析中...'}</p></div>
        <div class="analysis-part"><h5>🔍 成分拆解</h5><p>${sentence.analysis.components || ''}</p></div>
        <div class="analysis-part"><h5>⚠️ 重难点</h5><p>${sentence.analysis.difficulty || ''}</p></div>
        <div class="analysis-part"><h5>📝 参考译文</h5><p>${sentence.analysis.translation || ''}</p></div>
      `;
    } else {
      analysis.innerHTML = '<p style="color:var(--text-light)">暂无详细解析，可尝试重新通过AI解析</p>';
    }
  },

  showAddModal() {
    Utils.showModal('添加长难句', `
      <div class="input-group">
        <label>长难句原文</label>
        <textarea id="modal-sentence-text" rows="4" placeholder="输入或粘贴长难句..." class="setting-input"></textarea>
      </div>
      <div class="input-group">
        <label>来源（可选）</label>
        <input type="text" id="modal-sentence-source" placeholder="如：2023年真题 Text 1" class="setting-input">
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;cursor:pointer">
        <input type="checkbox" id="use-ai-analyze" checked>
        <span>使用AI智能解析（需配置DeepSeek Key）</span>
      </label>
    `, `<button class="btn-primary" id="save-sentence-btn">保存</button>
       <button class="btn-outline" onclick="Utils.hideModal()">取消</button>`);

    document.getElementById('save-sentence-btn').onclick = () => this.saveSentence();
  },

  async saveSentence() {
    const text = document.getElementById('modal-sentence-text').value.trim();
    if (!text) { Utils.toast('请输入长难句'); return; }

    const source = document.getElementById('modal-sentence-source').value.trim();
    const useAI = document.getElementById('use-ai-analyze').checked;

    const user = Store.getCurrentUser();
    const sentence = {
      id: Utils.uid(),
      username: user,
      original: text,
      source,
      analysis: null,
      createdAt: new Date().toISOString()
    };

    if (useAI) {
      const settings = Store.getSettings(user);
      if (settings.deepseekKey) {
        try {
          sentence.analysis = await this.analyzeWithAI(settings, text);
          Utils.toast('AI解析完成！');
        } catch (e) {
          Utils.toast('AI解析失败，已保存原文：' + e.message);
        }
      }
    }

    await Store.put('sentences', sentence);
    Utils.hideModal();
    Utils.toast('长难句已保存');
    this.renderList();
  },

  async analyzeWithAI(settings, text) {
    const res = await fetch(`${settings.deepseekBase || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.deepseekKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{
          role: 'system',
          content: `你是考研英语长难句解析专家。对以下句子进行分层解析，用中文回答。格式要求：
1. 句法结构：说明句子类型（简单句/并列复合句/主从复合句等）
2. 成分拆解：逐层拆解主语、谓语、宾语、定语、状语、补语等，标注清楚修饰关系
3. 重难点：指出语法难点、特殊结构、易错点
4. 参考译文：准确流畅的中文译文

请严格按以上四个部分回答，每个部分用换行分隔。`
        }, {
          role: 'user',
          content: `请解析以下长难句：\n${text}`
        }],
        max_tokens: 2000,
        temperature: 0.3
      })
    });

    if (!res.ok) throw new Error('API调用失败');
    const data = await res.json();
    const responseText = data.choices[0].message.content;

    // 解析返回的结构化文本
    const parts = responseText.split(/\n(?=[\d\u4e00-\u9fa5])/);
    return {
      structure: parts[0] || '',
      components: parts.slice(1, -2).join('\n') || '',
      difficulty: parts[parts.length - 2] || '',
      translation: parts[parts.length - 1] || ''
    };
  }
};
