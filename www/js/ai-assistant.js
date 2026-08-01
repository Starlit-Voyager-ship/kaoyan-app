/* ========================================
   AI助理模块（双模型：DeepSeek + 千问VL）
   ======================================== */

const AIAssistant = {
  messages: [],
  hasConfigured: false,

  init() {
    this.bindEvents();
    this.checkConfig();
    this.loadHistory();
  },

  bindEvents() {
    // 发送按钮
    document.getElementById('chat-send').addEventListener('click', () => this.send());

    // 回车发送
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });

    // 图片上传
    document.getElementById('upload-image-btn').addEventListener('click', () => {
      document.getElementById('image-upload').click();
    });
    document.getElementById('image-upload').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleImageUpload(e.target.files[0]);
    });

    // 模型切换
    document.getElementById('ai-model-select').addEventListener('change', (e) => {
      const isVL = e.target.value === 'qwen-vl';
      document.getElementById('upload-image-btn').style.display = isVL ? 'flex' : 'none';
    });
  },

  checkConfig() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user);
    const hasDS = settings.deepseekKey && settings.deepseekKey.length > 10;
    const hasQW = settings.qwenKey && settings.qwenKey.length > 10;

    this.hasConfigured = hasDS || hasQW;
    const banner = document.getElementById('ai-config-banner');
    banner.classList.toggle('hidden', this.hasConfigured);

    // 默认隐藏图片上传（仅千问VL模式显示）
    document.getElementById('upload-image-btn').style.display =
      document.getElementById('ai-model-select').value === 'qwen-vl' ? 'flex' : 'none';
  },

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
      row.innerHTML = `
        <div class="msg-avatar">${msg.role === 'user' ? '👤' : '🤖'}</div>
        <div class="msg-bubble">
          ${msg.image ? `<img src="${msg.image}" class="msg-image" onclick="window.open(this.src)">` : ''}
          <div>${this.escapeHtml(msg.content)}</div>
          <div class="msg-time">${new Date(msg.timestamp).toLocaleTimeString()}</div>
        </div>
      `;
      container.appendChild(row);
    });

    container.scrollTop = container.scrollHeight;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  },

  async send() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    const modelSelect = document.getElementById('ai-model-select');
    const model = modelSelect.value;

    if (!text && !this.pendingImage) return;

    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user);

    if (model === 'deepseek' && !settings.deepseekKey) {
      Utils.toast('请先配置 DeepSeek API Key');
      return;
    }
    if (model === 'qwen-vl' && !settings.qwenKey) {
      Utils.toast('请先配置 千问VL API Key');
      return;
    }

    // 添加用户消息
    const userMsg = {
      id: Utils.uid(),
      role: 'user',
      content: text || '[图片]',
      image: this.pendingImage || null,
      model,
      username: user,
      timestamp: new Date().toISOString()
    };
    this.messages.push(userMsg);
    await Store.put('ai_chats', userMsg);

    input.value = '';
    this.pendingImage = null;
    this.renderMessages();

    // 显示AI思考状态
    this.showTyping();

    try {
      let response;
      if (model === 'qwen-vl') {
        response = await this.callQwenVL(settings, userMsg);
      } else {
        response = await this.callDeepSeek(settings, userMsg);
      }

      // 保存AI回复
      const aiMsg = {
        id: Utils.uid(),
        role: 'ai',
        content: response,
        model,
        username: user,
        timestamp: new Date().toISOString()
      };
      this.messages.push(aiMsg);
      await Store.put('ai_chats', aiMsg);

      // 如果是数学题目，自动录入题库并加金币
      if (this.containsMathContent(text) || userMsg.image) {
        this.autoSaveMathQuestion(user, userMsg, response);
      }

      this.hideTyping();
      this.renderMessages();
    } catch (err) {
      this.hideTyping();
      this.showError(err.message);
    }
  },

  async callDeepSeek(settings, userMsg) {
    const messages = [
      {
        role: 'system',
        content: `你是一个专业的考研学习AI助理。用户正在备考研究生入学考试（数学二、英语二）。
你的任务：
1. 数学问题：给出详细解题步骤、关键知识点、易错点提醒
2. 英语问题：词汇解析、语法讲解、长难句拆解、作文指导
3. 政治/专业课：根据已有知识回答
4. 学习建议：提供个性化学习建议

注意：
- 回答要简洁明了，重点突出
- 数学题要有完整步骤
- 英语翻译要准确自然
- 使用中文回答`
      }
    ];

    // 取最近20条对话作为上下文
    const recent = this.messages.slice(-20);
    recent.forEach(m => {
      messages.push({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      });
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

  async callQwenVL(settings, userMsg) {
    const content = [];
    if (userMsg.image) {
      content.push({
        type: 'image_url',
        image_url: { url: userMsg.image }
      });
    }
    if (userMsg.content && userMsg.content !== '[图片]') {
      content.push({ type: 'text', text: userMsg.content });
    }
    if (content.length === 0) {
      content.push({ type: 'text', text: '请识别这张图片中的内容' });
    }

    const res = await fetch(`${settings.qwenBase || 'https://dashscope.aliyuncs.com/api/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.qwenKey}`
      },
      body: JSON.stringify({
        model: 'qwen-vl-max',
        messages: [{
          role: 'user',
          content
        }],
        max_tokens: 2000
      })
    });

    if (!res.ok) throw new Error(`API错误 (${res.status})`);
    const data = await res.json();
    return data.choices[0].message.content;
  },

  pendingImage: null,

  async handleImageUpload(file) {
    const base64 = await Utils.imgToBase64(file);
    const compressed = await Utils.compressImg(base64);
    this.pendingImage = compressed;

    // 预览
    const input = document.getElementById('chat-input');
    input.value = `[已选择图片: ${file.name}]`;
    Utils.toast('图片已加载，点击发送');
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
      </div>
    `;
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
      </div>
    `;
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  },

  containsMathContent(text) {
    const mathKeywords = ['矩阵', '行列式', '向量', '方程组', '特征值', '二次型', '积分', '导数', '极限', '微分',
      'matrix', 'determinant', 'vector', 'eigenvalue', 'derivative', 'integral', '题目', '求解', '证明'];
    return mathKeywords.some(kw => text.includes(kw));
  },

  async autoSaveMathQuestion(username, userMsg, aiResponse) {
    // 自动识别知识点
    const topics = ['行列式', '矩阵', '向量', '线性方程组', '特征值与特征向量', '二次型'];
    const fullText = (userMsg.content + ' ' + aiResponse).toLowerCase();
    const detectedTopic = topics.find(t => fullText.includes(t)) || '未分类';

    await Store.put('math_questions', {
      id: Utils.uid(),
      username,
      source: userMsg.image ? 'AI识图' : 'AI咨询',
      topic: detectedTopic,
      ocrText: userMsg.content.substring(0, 500),
      imageData: userMsg.image || null,
      aiResponse: aiResponse.substring(0, 1000),
      createdAt: new Date().toISOString()
    });

    // 加金币：每道数学题+5金币
    await Store.addCoins(username, 5);

    // 更新薄弱点
    await Store.put('math_weak_points', {
      id: Utils.uid(),
      username,
      topic: detectedTopic,
      questionId: userMsg.id,
      count: 1,
      lastReview: new Date().toISOString()
    });
  }
};
