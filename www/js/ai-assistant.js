/* ========================================
   AI助理模块（双链路：上传归档 + 智能解答）
   - 上传归档：拍照/相册 → 千问VL 识别分类 → 数学题入题库 / 英语文章入文章库（不调 deepseek）
   - 智能解答：拍照/相册或打字 → 千问VL 识图 → 千问文本解答（qwen-max）
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
  activeMode: 'answer',     // 默认进入对话模式
  pendingImage: null,       // 解答面板待发送图片
  uploadImage: null,        // 上传面板图片
  messages: [],
  hasConfigured: false,
  _pendingPanel: 'answer',

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
    // 顶部上传抽屉切换
    document.getElementById('ai-upload-toggle').addEventListener('click', () => this.toggleUploadDrawer());

    // 上传面板
    document.getElementById('upload-camera-btn').addEventListener('click', () => this.capture('upload', 'camera'));
    document.getElementById('upload-gallery-btn').addEventListener('click', () => this.capture('upload', 'gallery'));
    document.getElementById('upload-clear-btn').addEventListener('click', () => this.clearUpload());
    document.getElementById('upload-go-btn').addEventListener('click', () => this.doUpload());

    // 对话面板
    document.getElementById('answer-camera-btn').addEventListener('click', () => this.capture('answer', 'camera'));
    document.getElementById('answer-gallery-btn').addEventListener('click', () => this.capture('answer', 'gallery'));
    document.getElementById('answer-clear-img').addEventListener('click', () => this.clearAnswerImage());
    document.getElementById('answer-voice-btn').addEventListener('click', () => Utils.toast('语音输入暂不支持'));
    document.getElementById('chat-more-btn').addEventListener('click', () => Utils.toast('更多功能开发中'));
    document.getElementById('chat-send').addEventListener('click', () => this.sendAnswer());
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendAnswer(); }
    });

    // 快捷 chips
    document.querySelectorAll('.ai-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        input.value = chip.dataset.prompt;
        input.focus();
      });
    });

    // Web 回退：共享文件输入（无原生相机时）
    document.getElementById('camera-file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
      e.target.value = '';
    });
  },

  toggleUploadDrawer() {
    const drawer = document.getElementById('ai-upload-drawer');
    const isHidden = drawer.style.display === 'none';
    drawer.style.display = isHidden ? 'block' : 'none';
  },

  switchMode(mode) {
    this.activeMode = mode;
    const drawer = document.getElementById('ai-upload-drawer');
    if (drawer) drawer.style.display = mode === 'upload' ? 'block' : 'none';
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
    const quality = this._pendingPanel === 'upload' ? 0.92 : 0.85; // 上传归档用更高质量保 OCR 清晰
    const compressed = await Utils.compressImg(base64, 1280, quality);
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
    const hasQW = settings.qwenKey && settings.qwenKey.length > 10;
    this.hasConfigured = hasQW;
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
        const ocrText = v.text || '';
        // 识别后自动让千问生成解析（不依赖历史对话），失败仅保存题目
        let solution = '';
        if (ocrText) {
          try {
            Utils.toast('正在生成解析…');
            solution = await this.callQwenSolve(settings, ocrText);
          } catch (solveErr) {
            console.warn('[上传归档] 解析生成失败，仅保存题目：', solveErr.message);
            Utils.toast('解析生成失败（' + solveErr.message + '），题目已保存');
          }
        }
        await Store.put('math_questions', {
          id: Utils.uid(),
          username: user,
          source,
          topic,
          errorReason,
          ocrText,
          imageData: this.uploadImage,
          aiResponse: solution,
          createdAt: new Date().toISOString()
        });
        await Store.addCoins(user, 5);
        const resultBody = `知识点：${topic}\n错因：${errorReason || '（未填写）'}\n\n识别文字：\n${ocrText}` +
          (solution ? `\n\nAI解析：\n${solution}` : '\n\n（解析生成失败，题目已保存，可在题库详情中重新获取）');
        this.showUploadResult('已归档到【数学题库】' + (solution ? '（含AI解析）' : ''), resultBody);
      } else if (v.type === 'english') {
        const title = source ? source : ('AI上传文章 ' + new Date().toLocaleDateString());
        await Store.put('articles', {
          id: Utils.uid(),
          username: user,
          title,
          source: source || '',
          content: v.text || '',
          imageData: this.uploadImage,
          createdAt: new Date().toISOString()
        });
        this.showUploadResult('已归档到【英语文章】',
          `标题：${title}\n\n英文全文：\n${v.text || ''}`);
      } else {
        this.showUploadResult('ℹ️ 未识别为数学题或英语文章',
          `识别内容：\n${v.text || ''}\n\n如需解答，请切换到「智能解答」Tab。`);
      }
    } catch (e) {
      this.showUploadResult('识别失败', e.message);
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
      <div class="result-body">${this.formatContent(body)}</div>
    </div>`;
    this.renderMath(el.querySelector('.result-body'));
  },

  /* ============================================================
     链路二：智能解答（千问VL 识图 → 千问文本解答）
     ============================================================ */
  async sendAnswer() {
    const input = document.getElementById('chat-input');
    const text = input.value.replace('[已选择图片]', '').trim();
    const img = this.pendingImage;
    if (!text && !img) return;

    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user) || {};
    if (!settings.qwenKey) { Utils.toast('请先配置千问 Key（在设置页填写）'); return; }

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
      const response = await this.callQwenText(settings, userMsg, visionText);
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

  /* ---------- 通用千问文本对话：走 proxyFetch，浏览器端经 Bmob 代理（国内可达），App 内直连 ---------- */
  async callQwenChat(settings, messages, taskName) {
    const url = `${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
    try {
      const res = await this.proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.qwenKey}`
        },
        body: JSON.stringify({
          model: 'qwen-max',
          messages,
          max_tokens: 2000,
          temperature: 0.7
        })
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let detail = '';
        try {
          const j = JSON.parse(txt);
          detail = j.error?.message || j.message || '';
        } catch (_) {}
        const code = res.status;
        let hint = detail;
        if (code === 401) hint = '千问 Key 无效或已过期，请检查设置';
        else if (code === 429) hint = '请求太频繁，请稍后再试';
        else if (code >= 500) hint = '千问服务暂时异常，请稍后再试';
        else if (!hint) hint = `请求失败 (HTTP ${code})`;
        throw new Error(`${taskName}：${hint}`);
      }
      const data = await res.json();
      return data.choices[0].message.content;
    } catch (err) {
      if (err.name === 'TypeError' || /fetch|network|failed|abort/i.test(err.message)) {
        throw new Error(`${taskName}：网络请求失败。浏览器预览可能受 CORS 限制，请在 App 内测试；若已在 App 内，请检查网络连接。`);
      }
      throw err;
    }
  },

  async callQwenText(settings, userMsg, visionText) {
    const messages = [{ role: 'system', content: AI_SYSTEM_PROMPT }];
    // 限制历史条数，避免通过 Bmob 代理时触发 413（请求体过大）
    const MAX_HISTORY = this.isNativePlatform() ? 20 : 6;
    const recent = this.messages.slice(-MAX_HISTORY);
    recent.forEach(m => {
      let c = m.content;
      if (m.role === 'user' && m.image && m === userMsg && visionText) {
        c = '[图片识别内容]\n' + visionText + '\n\n' + (c === '[图片]' ? '' : c);
      }
      if (c) messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: c });
    });
    return await this.callQwenChat(settings, messages, '千问解答');
  },

  /* ---------- 上传归档专用：仅依据题目文字生成解析（不依赖对话历史） ---------- */
  async callQwenSolve(settings, questionText) {
    const messages = [
      {
        role: 'system',
        content: '你是考研数学二 AI 解题老师。请针对下面这道题给出详细解析，结构如下：\n' +
          '【考查知识点】用一两句话说明本题涉及的核心考点；\n' +
          '【解题思路】点明突破口与关键方法；\n' +
          '【完整步骤】逐步推导，关键变形与计算都要写出；\n' +
          '【最终答案】给出明确结果；\n' +
          '【易错提醒】指出常见错误。\n' +
          '数学公式使用标准 LaTeX：块级用 $$ ... $$，行内用 \\( ... \\)。用中文回答，结构清晰、段落自然。'
      },
      { role: 'user', content: questionText }
    ];
    return await this.callQwenChat(settings, messages, '千问解析');
  },

  /* ---------- 跨平台 API 请求：App 直连，浏览器走本地代理 ---------- */
  isNativePlatform() {
    return typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  },

  async proxyFetch(url, options) {
    if (this.isNativePlatform()) return fetch(url, options);
    // 浏览器端：优先直连（dashscope 支持 CORS），失败再走代理
    try {
      console.log('[AI代理调试] 尝试直连:', url);
      const direct = await fetch(url, options);
      if (direct.ok || direct.status === 401 || direct.status === 429) {
        console.log('[AI代理调试] 直连成功, status:', direct.status);
        return direct;
      }
      // 直连返回错误但非 CORS 问题，也直接返回让上层处理
      if (direct.status !== 0) return direct;
    } catch (e) {
      console.log('[AI代理调试] 直连失败:', e.message, '→ 走 Bmob 代理');
    }

    // 回退：Bmob 云函数 aiProxy
    const mode = (window.APP_CONFIG && window.APP_CONFIG.proxyMode) || 'bmob';
    let bodyObj;
    if (typeof options.body === 'string') {
      try { bodyObj = JSON.parse(options.body); } catch (_) { bodyObj = {}; }
    } else {
      bodyObj = options.body || {};
    }

    if (mode === 'cloudflare') {
      const proxyUrl = (window.APP_CONFIG && window.APP_CONFIG.proxyUrl) || '/api/proxy';
      return fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, headers: options.headers, body: bodyObj })
      });
    }

    if (typeof Bmob === 'undefined' || !Bmob.hasCredentials()) {
      throw new Error('未配置 Bmob 凭证，AI 代理不可用（请在设置中确认已登录 / 已配置 Bmob）');
    }
    const data = await Bmob.request('POST', '/functions/aiProxy', { url, headers: options.headers, body: bodyObj }, false);
    const r = (data && data.result) || {};
    console.log('[AI代理调试] aiProxy 返回 status:', r.status, '| body前100字:', String(r.body || '').slice(0, 100));
    return new Response(r.body != null ? r.body : '', {
      status: r.status || 502,
      headers: { 'Content-Type': r.contentType || 'application/json' }
    });
  },

  /* ---------- 千问VL：分类（数学/英语/其他）+ 提取文字 ---------- */
  topicListForVL() {
    if (typeof MATH_TOPICS === 'undefined') return '行列式/矩阵/向量/线性方程组/特征值与特征向量/二次型/其他';
    const all = MATH_TOPICS.flatMap(g => g.subs);
    return all.join('/') + '/其他';
  },

  async requestQwen(settings, content, taskName) {
    const url = `${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
    try {
      const res = await this.proxyFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.qwenKey}` },
        body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content }], max_tokens: 2000 })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        let detail = '';
        try {
          const j = JSON.parse(txt);
          detail = j.error?.message || j.message || '';
        } catch (_) {}
        const code = res.status;
        let hint = detail;
        if (code === 401) hint = 'Key 无效或已过期，请检查设置中的「千问VL Key」';
        else if (code === 429) hint = '请求太频繁，请稍后再试';
        else if (code >= 500) hint = '千问服务暂时异常，请稍后再试';
        else if (!hint) hint = `请求失败 (HTTP ${code})`;
        throw new Error(`${taskName}：${hint}`);
      }
      const data = await res.json();
      return data.choices[0].message.content;
    } catch (err) {
      if (err.name === 'TypeError' || /fetch|network|failed|abort/i.test(err.message)) {
        throw new Error(`${taskName}：网络请求失败。浏览器预览可能受 CORS 限制，请在 App 内测试；若已在 App 内，请检查网络连接。`);
      }
      throw err;
    }
  },

  async callQwenVLClassify(settings, imageData) {
    const content = [
      { type: 'image_url', image_url: { url: imageData } },
      { type: 'text', text: '请仔细识别图片中的内容。先判断类型，再逐字提取原文，最后以 JSON 返回（只返回 JSON，不要任何额外文字或解释）：\n' +
        `{"type":"math|english|other","topic":"若为数学题请填知识点(${this.topicListForVL()})","errorHint":"若图片中可见明显错误原因请简述，否则为空字符串","text":"逐字提取图片中的题目或文章原文。数学公式和符号必须用可读的纯文字表达（例如：λx₁+x₂+x₃=λ-3、矩阵A=[1 λ; -2 1]、行列式|A|），绝对不要输出LaTeX代码（不要\\left、\\begin{array}、\\lambda等LaTeX标记），不要用任何特殊格式，就是普通文字"}` }
    ];
    const raw = await this.requestQwen(settings, content, '千问VL识别');
    return this.parseJSON(raw);
  },

  /* ---------- 千问VL：仅识图提取文字（用于解答链路） ---------- */
  async callQwenVLOcr(settings, imageData) {
    const content = [
      { type: 'image_url', image_url: { url: imageData } },
      { type: 'text', text: '请识别图片中的题目或内容，提取完整文字。数学公式用可读纯文字表达（如 λx₁+x₂=3、矩阵A=[1 2; 3 4]），不要输出LaTeX代码（\\left、\\begin等），不要解答。' }
    ];
    return await this.requestQwen(settings, content, '千问VL识图');
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
    // 0) 保护 LaTeX 块，避免被段落拆分/换行处理破坏结构
    const mathPlaceholders = [];
    const protected = text.replace(/(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\]|\\\([\s\S]*?\\\))/g, (match) => {
      const idx = mathPlaceholders.length;
      mathPlaceholders.push(match);
      return '\x00MATH' + idx + '\x00';
    });
    // 1) 转义 HTML，防 XSS
    const safe = this.escapeHtml(protected);
    // 2) 按空行分段落
    let result = safe.split(/\n\s*\n/).map(p => {
      if (!p.trim()) return '';
      if (p.includes('\x00')) return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; // 含 LaTeX 的段落保留换行
      const hasList = /^\s*(\d+[\.\、)]|[-*+])\s+/m.test(p);
      return '<p>' + (hasList ? p.replace(/\n/g, '<br>') : p.replace(/\n/g, ' ')) + '</p>';
    }).join('');
    // 3) 还原 LaTeX 块
    mathPlaceholders.forEach((m, i) => {
      result = result.split('\x00MATH' + i + '\x00').join(m);
    });
    return result;
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
      <div class="msg-bubble" style="color:#ef4444;">
        ${msg}<br><small>请检查API Key配置是否正确</small>
      </div>`;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  }
};
