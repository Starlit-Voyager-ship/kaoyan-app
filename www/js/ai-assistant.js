/* ========================================
   AI助理模块（双链路：上传归档 + 智能解答）
   - 上传归档：拍照/相册 → 千问VL 识别分类 → 数学题入题库 / 英语文章入文章库（不调 deepseek）
   - 智能解答：拍照/相册或打字 → 千问VL 识图 → DeepSeek 解答
   - 模型 Key 由用户在设置中自行填写
   ======================================== */

const AI_SYSTEM_PROMPT = `你是一个专业的考研学习AI助理。用户正在备考研究生入学考试（数学二、英语二）。
你的任务：
1. 数学问题：给出详细解题步骤、关键知识点、易错点提醒
2. 英语问题：词汇解析、语法讲解、长难句拆解、作文指导
3. 政治/专业课：根据已有知识回答
4. 学习建议：提供个性化学习建议

注意：
- 回答要简洁明了，重点突出，段落自然，不要每行只写几个词
- 数学题要有完整步骤；数学公式请使用标准 LaTeX 格式（行内用 \\( ... \\)，块级用 \\[ ... \\] 或 $$ ... $$），页面会自动渲染，避免使用 $...$ 简写
- 英语翻译要准确自然
- 使用中文回答`;

const AIAssistant = {
  activeMode: 'upload',     // 'upload' | 'answer'
  pendingImage: null,       // 解答面板待发送图片
  uploadImage: null,        // 上传面板图片
  messages: [],
  hasConfigured: false,
  _pendingPanel: 'upload',

  init() {
    if (typeof Capacitor !== 'undefined' && Capacitor.registerPlugin) {
      try { Capacitor.registerPlugin('Camera'); } catch (e) {}
    }
    this.bindEvents();
    this.checkConfig();
    this.loadHistory();
  },

  cameraAvailable() {
    return typeof Capacitor !== 'undefined' && Capacitor.Plugins && Capacitor.Plugins.Camera;
  },

  bindEvents() {
    // Tab 切换
    document.querySelectorAll('.ai-tab').forEach(btn => {
      btn.addEventListener('click', () => this.switchMode(btn.dataset.mode));
    });

    // 上传面板
    document.getElementById('upload-camera-btn').addEventListener('click', () => this.capture('upload', 'camera'));
    document.getElementById('upload-gallery-btn').addEventListener('click', () => this.capture('upload', 'gallery'));
    document.getElementById('upload-clear-btn').addEventListener('click', () => this.clearUpload());
    document.getElementById('upload-go-btn').addEventListener('click', () => this.doUpload());

    // 解答面板
    document.getElementById('answer-camera-btn').addEventListener('click', () => this.capture('answer', 'camera'));
    document.getElementById('answer-gallery-btn').addEventListener('click', () => this.capture('answer', 'gallery'));
    document.getElementById('answer-clear-img').addEventListener('click', () => this.clearAnswerImage());
    document.getElementById('chat-send').addEventListener('click', () => this.sendAnswer());
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendAnswer(); }
    });

    // Web 回退：共享文件输入（无原生相机时）
    document.getElementById('camera-file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
      e.target.value = '';
    });
  },

  switchMode(mode) {
    this.activeMode = mode;
    document.querySelectorAll('.ai-tab').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    document.getElementById('ai-upload-panel').style.display = mode === 'upload' ? 'block' : 'none';
    document.getElementById('ai-answer-panel').style.display = mode === 'answer' ? 'block' : 'none';
  },

  /* ---------- 取图（原生相机/相册 或 Web 回退） ---------- */
  async capture(panel, kind) {
    if (this.cameraAvailable()) {
      try {
        const r = kind === 'camera'
          ? await Capacitor.Plugins.Camera.takePhoto()
          : await Capacitor.Plugins.Camera.pickFromGallery();
        if (r && r.data) this.setImage(panel, r.data);
      } catch (e) {
        Utils.toast('相机/相册已取消');
      }
      return;
    }
    // Web 回退：用隐藏文件输入
    this._pendingPanel = panel;
    const input = document.getElementById('camera-file-input');
    if (kind === 'camera') input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  },

  async handleFile(file) {
    const base64 = await Utils.imgToBase64(file);
    const compressed = await Utils.compressImg(base64, 1280, 0.85);
    this.setImage(this._pendingPanel || this.activeMode, compressed);
  },

  setImage(panel, dataUrl) {
    if (panel === 'upload') {
      this.uploadImage = dataUrl;
      const img = document.getElementById('upload-img');
      img.src = dataUrl; img.style.display = 'block';
      document.getElementById('upload-empty').style.display = 'none';
      document.getElementById('upload-clear-btn').style.display = 'inline-flex';
      document.getElementById('upload-go-btn').disabled = false;
    } else {
      this.pendingImage = dataUrl;
      document.getElementById('answer-clear-img').style.display = 'inline-flex';
      const input = document.getElementById('chat-input');
      if (!input.value.includes('[已选择图片]')) input.value = '[已选择图片] ' + input.value;
      Utils.toast('图片已加载，点击发送');
    }
  },

  clearUpload() {
    this.uploadImage = null;
    document.getElementById('upload-img').style.display = 'none';
    document.getElementById('upload-empty').style.display = 'block';
    document.getElementById('upload-clear-btn').style.display = 'none';
    document.getElementById('upload-go-btn').disabled = true;
    document.getElementById('upload-result').innerHTML = '';
  },

  clearAnswerImage() {
    this.pendingImage = null;
    document.getElementById('answer-clear-img').style.display = 'none';
    const input = document.getElementById('chat-input');
    input.value = input.value.replace('[已选择图片] ', '');
  },

  /* ---------- 配置检查 ---------- */
  checkConfig() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user) || {};
    const hasDS = settings.deepseekKey && settings.deepseekKey.length > 10;
    const hasQW = settings.qwenKey && settings.qwenKey.length > 10;
    this.hasConfigured = hasDS || hasQW;
    const banner = document.getElementById('ai-config-banner');
    if (banner) banner.classList.toggle('hidden', this.hasConfigured);
  },

  /* ============================================================
     链路一：上传归档
     ============================================================ */
  async doUpload() {
    if (!this.uploadImage) return;
    const settings = Store.getSettings(Store.getCurrentUser()) || {};
    if (!settings.qwenKey) { Utils.toast('上传归档需先配置千问VL Key'); return; }

    const source = document.getElementById('upload-source').value;
    const topicInput = document.getElementById('upload-topic').value;
    const errorInput = document.getElementById('upload-error').value.trim();

    this.showUploadLoading(true);
    try {
      const v = await this.callQwenVLClassify(settings, this.uploadImage);
      const topic = topicInput || v.topic || '其他';
      const errorReason = errorInput || v.errorHint || '';
      const user = Store.getCurrentUser();

      if (v.type === 'math') {
        await Store.put('math_questions', {
          id: Utils.uid(),
          username: user,
          source,
          topic,
          errorReason,
          ocrText: v.text || '',
          imageData: this.uploadImage,
          aiResponse: '',
          createdAt: new Date().toISOString()
        });
        await Store.addCoins(user, 5);
        this.showUploadResult('✅ 已归档到【数学题库】',
          `知识点：${topic}\n错因：${errorReason || '（未填写）'}\n\n识别文字：\n${v.text || ''}`);
      } else if (v.type === 'english') {
        const title = 'AI上传文章 ' + new Date().toLocaleDateString();
        await Store.put('articles', {
          id: Utils.uid(),
          username: user,
          title,
          content: v.text || '',
          imageData: this.uploadImage,
          createdAt: new Date().toISOString()
        });
        this.showUploadResult('✅ 已归档到【英语文章】',
          `标题：${title}\n\n英文全文：\n${v.text || ''}`);
      } else {
        this.showUploadResult('ℹ️ 未识别为数学题或英语文章',
          `识别内容：\n${v.text || ''}\n\n如需解答，请切换到「智能解答」Tab。`);
      }
    } catch (e) {
      this.showUploadResult('❌ 识别失败', e.message);
    } finally {
      this.showUploadLoading(false);
    }
  },

  showUploadLoading(on) {
    const btn = document.getElementById('upload-go-btn');
    btn.disabled = on;
    btn.textContent = on ? '识别中…' : '识别并归档';
  },

  showUploadResult(title, body) {
    const el = document.getElementById('upload-result');
    el.innerHTML = `<div class="result-card">
      <div class="result-title">${title}</div>
      <div class="result-body">${this.escapeHtml(body).replace(/\n/g, '<br>')}</div>
    </div>`;
  },

  /* ============================================================
     链路二：智能解答（千问VL 识图 → DeepSeek 解答）
     ============================================================ */
  async sendAnswer() {
    const input = document.getElementById('chat-input');
    const text = input.value.replace('[已选择图片]', '').trim();
    const img = this.pendingImage;
    if (!text && !img) return;

    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user) || {};
    if (!settings.deepseekKey) { Utils.toast('请先配置 DeepSeek Key'); return; }
    if (img && !settings.qwenKey) { Utils.toast('发送图片需配置「千问VL(DashScope)」Key（与 DeepSeek Key 分开，在设置页填写）'); return; }

    const userMsg = {
      id: Utils.uid(),
      role: 'user',
      content: text || '[图片]',
      image: img || null,
      timestamp: new Date().toISOString()
    };
    this.messages.push(userMsg);
    await Store.put('ai_chats', userMsg);

    input.value = '';
    this.pendingImage = null;
    document.getElementById('answer-clear-img').style.display = 'none';
    this.renderMessages();
    this.showTyping();

    try {
      let visionText = '';
      if (img) visionText = await this.callQwenVLOcr(settings, img);
      const response = await this.callDeepSeek(settings, userMsg, visionText);
      const aiMsg = {
        id: Utils.uid(),
        role: 'ai',
        content: response,
        timestamp: new Date().toISOString()
      };
      this.messages.push(aiMsg);
      await Store.put('ai_chats', aiMsg);
      this.hideTyping();
      this.renderMessages();
    } catch (err) {
      this.hideTyping();
      this.showError(err.message);
    }
  },

  async callDeepSeek(settings, userMsg, visionText) {
    const messages = [{ role: 'system', content: AI_SYSTEM_PROMPT }];
    const recent = this.messages.slice(-20);
    recent.forEach(m => {
      let c = m.content;
      if (m.role === 'user' && m.image && m === userMsg && visionText) {
        c = '[图片识别内容]\n' + visionText + '\n\n' + (c === '[图片]' ? '' : c);
      }
      if (c) messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: c });
    });

    const res = await fetch(`${settings.deepseekBase || 'https://api.deepseek.com'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.deepseekKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    if (!res.ok) throw new Error(`API错误 (${res.status})`);
    const data = await res.json();
    return data.choices[0].message.content;
  },

  /* ---------- 千问VL：分类（数学/英语/其他）+ 提取文字 ---------- */
  async callQwenVLClassify(settings, imageData) {
    const content = [
      { type: 'image_url', image_url: { url: imageData } },
      { type: 'text', text: '请识别图片内容并以 JSON 返回（只返回 JSON，不要额外文字）：' +
        '{"type":"math|english|other","topic":"若为数学题请填知识点(行列式/矩阵/向量/线性方程组/特征值与特征向量/二次型/其他)","errorHint":"若可见明显错因请简述，否则为空字符串","text":"提取的题目或文章文字"}。' }
    ];
    const res = await fetch(`${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.qwenKey}` },
      body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content }], max_tokens: 2000 })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`千问VL错误 (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    return this.parseJSON(data.choices[0].message.content);
  },

  /* ---------- 千问VL：仅识图提取文字（用于解答链路） ---------- */
  async callQwenVLOcr(settings, imageData) {
    const content = [
      { type: 'image_url', image_url: { url: imageData } },
      { type: 'text', text: '请识别图片中的题目或内容，提取完整文字，不要解答。' }
    ];
    const res = await fetch(`${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.qwenKey}` },
      body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content }], max_tokens: 2000 })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`千问VL错误 (${res.status}): ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  },

  parseJSON(raw) {
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : raw);
    } catch (e) {
      return { type: 'other', topic: '', errorHint: '', text: raw };
    }
  },

  /* ---------- 通用：历史 / 渲染 / 错误 ---------- */
  async loadHistory() {
    const user = Store.getCurrentUser();
    const chats = await Store.getUserData('ai_chats', user);
    if (chats.length > 0) {
      this.messages = chats.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      this.renderMessages();
    }
  },

  renderMessages() {
    const container = document.getElementById('chat-messages');
    const welcome = document.getElementById('chat-welcome');
    if (this.messages.length === 0) {
      container.classList.remove('show');
      welcome.classList.remove('hidden');
      return;
    }
    welcome.classList.add('hidden');
    container.classList.add('show');
    container.innerHTML = '';
    this.messages.forEach(msg => {
      const row = document.createElement('div');
      row.className = `msg-row ${msg.role}`;
      const bubble = document.createElement('div');
      bubble.className = 'msg-bubble';
      bubble.innerHTML = `
        ${msg.image ? `<img src="${msg.image}" class="msg-image" onclick="window.open(this.src)">` : ''}
        <div class="msg-body">${this.formatContent(msg.content)}</div>
        <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>`;
      this.renderMath(bubble);
      row.innerHTML = `<div class="msg-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>`;
      row.appendChild(bubble);
      container.appendChild(row);
    });
    container.scrollTop = container.scrollHeight;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  formatContent(text) {
    if (!text) return '';
    // 1) 先转义 HTML，防止模型输出恶意标签
    const safe = this.escapeHtml(text);
    // 2) 按空行分段落，让中文排版像豆包一样自然（不是每行都硬换行）
    return safe.split(/\n\s*\n/).map(p => {
      if (!p.trim()) return '';
      // 若该段包含列表行（1. / - / *），保留换行；否则把单行换行合并成自然段落
      const hasList = /^\s*(\d+[\.\、)]|[-*+])\s+/m.test(p);
      return '<p>' + (hasList ? p.replace(/\n/g, '<br>') : p.replace(/\n/g, ' ')) + '</p>';
    }).join('');
  },

  renderMath(el) {
    if (typeof renderMathInElement === 'undefined') return;
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false }
        ],
        throwOnError: false,
        errorColor: '#ef4444'
      });
    } catch (e) { console.warn('KaTeX 渲染失败', e); }
  },

  showTyping() {
    const container = document.getElementById('chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.id = 'typing-msg';
    row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble">
        <div class="typing-indicator"><span></span><span></span><span></span></div>
      </div>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  },

  hideTyping() {
    const el = document.getElementById('typing-msg');
    if (el) el.remove();
  },

  showError(msg) {
    const container = document.getElementById('chat-messages');
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    row.innerHTML = `
      <div class="msg-avatar">🤖</div>
      <div class="msg-bubble" style="color:#ef4444;">
        ❌ ${msg}<br><small>请检查API Key配置是否正确</small>
      </div>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }
};
