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
- 使用中文回答

格式约束（重要）：
- 不要使用任何 markdown 装饰符：禁止输出 **加粗**、*斜体*、## 标题、- 或 * 或 + 开头的列表项、> 引用、\`代码块\`、~~删除线~~ 等无关格式
- 直接写自然中文段落和数学公式即可，不要在每行前面加 "- " 这种无意义的连字符
- 例外：数学公式中的 LaTeX 命令（\\frac、\\sum、\\int、\\lambda、\\cdot、\\times、+/-/= 等运算符、上下标 ^_）必须原样保留，这些是数学符号不是装饰符`;

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
    // 对话面板：拍照/相册（AI 解答）
    document.getElementById('answer-camera-btn').addEventListener('click', () => this.capture('answer', 'camera'));
    document.getElementById('answer-gallery-btn').addEventListener('click', () => this.capture('answer', 'gallery'));
    document.getElementById('answer-clear-img').addEventListener('click', () => this.clearAnswerImage());

    // 上传归档按钮（原语音位置）
    document.getElementById('answer-upload-btn').addEventListener('click', () => this.quickUpload());

    document.getElementById('chat-more-btn').addEventListener('click', () => Utils.toast('更多功能开发中'));
    document.getElementById('chat-send').addEventListener('click', () => this.sendAnswer());
    document.getElementById('chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendAnswer(); }
    });

    // Web 回退：共享文件输入（无原生相机时）
    document.getElementById('camera-file-input').addEventListener('change', (e) => {
      if (e.target.files[0]) this.handleFile(e.target.files[0]);
      e.target.value = '';
    });
    // Web 回退：上传归档文件输入（仅选图，归档由弹窗触发）
    document.getElementById('upload-file-input').addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      files.forEach(f => this.handleFile(f));
      e.target.value = '';
    });

    // 上传归档弹窗按钮
    document.getElementById('upload-modal-go').addEventListener('click', () => {
      if (this._uploadState === 'done') this.closeUploadModal();
      else this.doUpload();
    });
    document.getElementById('upload-modal-cancel').addEventListener('click', () => this.closeUploadModal());
    document.getElementById('upload-modal-close').addEventListener('click', () => this.closeUploadModal());
    document.getElementById('upload-modal-mask').addEventListener('click', (e) => {
      if (e.target.id === 'upload-modal-mask') this.closeUploadModal();
    });
    document.getElementById('upload-add-more').addEventListener('click', () => this.addMoreImages());
  },

  /* 快捷上传：选图后弹出归档弹窗填写来源/知识点 */
  async quickUpload() {
    this.uploadImages = [];
    this._pendingPanel = 'upload';
    await this.capture('upload', 'gallery');
    // 原生相机下图片已在 setImage 中入队并开弹窗；
    // Web 回退时 capture 仅触发 file input，图片稍后由 setImage 处理并开弹窗。
    if (!this.cameraAvailable() && (!this.uploadImages || !this.uploadImages.length)) {
      // 用户取消选择，不弹窗
    }
  },

  /* ---------- 取图（原生相机/相册 或 Web 回退） ---------- */
  async capture(panel, kind) {
    if (this.cameraAvailable()) {
      try {
        let imgs = [];
        if (kind === 'camera') {
          const r = await Capacitor.Plugins.Camera.takePhoto();
          if (r && r.data) imgs = [r.data];
        } else {
          const cam = Capacitor.Plugins.Camera;
          if (cam.pickImages) {
            const res = await cam.pickImages();
            imgs = (res && res.photos) ? res.photos.map(p => p.data).filter(Boolean) : [];
          } else {
            const r = await cam.pickFromGallery();
            if (r && r.data) imgs = [r.data];
          }
        }
        imgs.forEach(d => this.setImage(panel, d));
      } catch (e) {
        Utils.toast('相机/相册已取消');
      }
      return;
    }
    // Web 回退：用隐藏文件输入
    this._pendingPanel = panel;
    const input = (panel === 'upload')
      ? document.getElementById('upload-file-input')
      : document.getElementById('camera-file-input');
    if (kind === 'camera') input.setAttribute('capture', 'environment');
    else input.removeAttribute('capture');
    input.click();
  },

  /* 弹窗内继续追加图片（支持一次多选） */
  addMoreImages() {
    this._pendingPanel = 'upload';
    this.capture('upload', 'gallery');
  },

  async handleFile(file) {
    const base64 = await Utils.imgToBase64(file);
    // 上传归档：1024px + 0.7质量（OCR够用，单张约50-100KB，适配Bmob免费版限制）
    // AI问答：800px + 0.75（识别用，更小）
    const quality = this._pendingPanel === 'upload' ? 0.7 : 0.75;
    const maxWidth = this._pendingPanel === 'upload' ? 1024 : 800;
    const compressed = await Utils.compressImg(base64, maxWidth, quality);
    this.setImage(this._pendingPanel || this.activeMode, compressed);
  },

  setImage(panel, dataUrl) {
    if (panel === 'upload') {
      this.uploadImages = this.uploadImages || [];
      this.uploadImages.push(dataUrl);
      this.openUploadModal();
    } else {
      this.pendingImage = dataUrl;
      document.getElementById('answer-clear-img').style.display = 'inline-flex';
      const input = document.getElementById('chat-input');
      if (!input.value.includes('[已选择图片]')) input.value = '[已选择图片] ' + input.value;
      Utils.toast('图片已加载，点击发送');
    }
  },

  clearUpload() {
    this.uploadImages = [];
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
    if (!this.uploadImages || !this.uploadImages.length) return;
    const settings = Store.getSettings(Store.getCurrentUser()) || {};
    if (!settings.qwenKey) { Utils.toast('上传归档需先配置千问VL Key'); return; }

    const goBtn = document.getElementById('upload-modal-go');
    if (goBtn) { goBtn.disabled = true; goBtn.textContent = '处理中…'; }
    this._uploadState = 'loading';

    const sourceEl = document.getElementById('upload-source');
    const source = sourceEl ? sourceEl.value : '';
    const topicEl = document.getElementById('upload-topic');
    const topicInput = topicEl ? topicEl.value : '';
    const errorEl = document.getElementById('upload-error');
    const errorInput = errorEl ? errorEl.value.trim() : '';

    try {
      // 图片仅用于本地识别，不存云端（用户需求：只同步解析后的文字）
      // 文字图压缩策略：总 base64 预算 33KB（aiProxy 限制 40KB，给 JSON 留余量）
      // 单张目标 = 总预算 / 图数，按图数动态分配；文字图优先保分辨率 + 适中质量，避免压糊丢词少段
      const AI_TOTAL_BUDGET = 33 * 1024;
      const perImgTarget = Math.floor(AI_TOTAL_BUDGET / Math.max(1, this.uploadImages.length));
      const aiImages = [];
      for (const img of this.uploadImages) {
        let c = img;
        for (const [mw, q] of [[1200,0.78],[1100,0.72],[1000,0.68],[900,0.62],[800,0.58],[720,0.52],[640,0.48],[560,0.42],[480,0.38],[400,0.34]]) {
          c = await Utils.compressImg(c, mw, q);
          if ((c.substring(c.indexOf(',') + 1).length * 0.75) < perImgTarget) break;
        }
        aiImages.push(c);
      }

      // 逐张识图（每轮只发 1 张，避免多图 base64 累计超 aiProxy 限制），合并结果
      Utils.toast('正在识别图片…');
      const merged = { type: 'other', topic: '', errorHint: '', text: '' };
      const texts = [];
      const hints = [];
      for (const im of aiImages) {
        const r = await this.callQwenVLClassify(settings, [im]);
        if (r && r.text) texts.push(r.text);
        if (r && r.errorHint) hints.push(r.errorHint);
        if (r && r.topic) merged.topic = r.topic;
        if (r && r.type && r.type !== 'other') merged.type = r.type;
      }
      merged.text = texts.join('\n\n');
      merged.errorHint = hints.join('；');
      const v = merged;

      // —— 归属书籍 / 年份 ——
      const bookEl = document.getElementById('upload-book');
      const book = bookEl ? bookEl.value : '';
      let bookName = '', category = '', knowledgePoint = '', year = '', bkType = '';
      if (book) {
        const bk = (typeof MATH_BOOKS !== 'undefined') ? MATH_BOOKS.find(b => b.id === book) : null;
        if (bk) {
          bookName = bk.name; bkType = bk.type;
          if (bk.type === 'year') {
            year = (document.getElementById('upload-year') || {}).value || '';
            category = '历年真题';
          } else {
            knowledgePoint = topicInput || v.topic || '其他';
            category = (typeof categoryOfKp === 'function') ? categoryOfKp(knowledgePoint) : '高等数学';
          }
        }
      }

      // 兼容旧逻辑：topic 用于薄弱点/报表聚合
      let topic;
      if (!book) topic = topicInput || v.topic || '其他';
      else if (bkType === 'year') topic = year ? `历年真题·${year}` : '历年真题';
      else topic = knowledgePoint;

      const errorReason = errorInput || v.errorHint || '';
      const user = Store.getCurrentUser();

      // 不存图片：imageData 置空（文字结果已存云端，自动双端同步）
      const imageData = null;

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
          book,
          bookName,
          category,
          knowledgePoint,
          year,
          errorReason,
          ocrText,
          imageData,
          aiResponse: solution,
          createdAt: new Date().toISOString()
        });

        // 记录薄弱点
        const today = new Date().toISOString().slice(0, 10);
        try {
          await Store.put('math_weak_points', {
            id: Utils.uid(),
            username: user,
            topic,
            questionId: Utils.uid(),
            count: 1,
            date: today,
            lastReview: new Date().toISOString()
          });
        } catch (e) { console.warn('[薄弱点] 上传归档记录失败:', e.message); }
        const resultBody = `知识点：${topic}\n错因：${errorReason || '（未填写）'}\n\n识别文字：\n${ocrText}` +
          (solution ? `\n\nAI解析：\n${solution}` : '\n\n（解析生成失败，题目已保存，可在题库详情中重新获取）');
        this.showUploadResult('已归档到【数学题库】' + (solution ? '（含AI解析）' : ''), resultBody);
        this._afterUploadSuccess();
      } else if (v.type === 'english') {
        const title = source ? source : ('AI上传文章 ' + new Date().toLocaleDateString());
        // 优先：qwen-vl-max 直看多图，输出结构化 JSON（文章/题目分离更准）
        // 兜底：老 OCR + 文本模型
        let analysis = '';
        let articleText = v.text || '';
        // 估算 aiImages 总 base64 字节数
        const totalBytes = aiImages.reduce((sum, im) => {
          const b64 = (im || '').replace(/^data:[^;]+;base64,/, '');
          return sum + Math.ceil((b64.length || 0) * 0.75);
        }, 0);
        const canVL = aiImages.length > 0 && aiImages.length <= 2 && totalBytes < 33 * 1024;
        if (canVL) {
          try {
            Utils.toast('视觉模型直读图片，分析文章与题目…');
            const parsed = await this.callQwenEnglishAnalyzeVL(settings, aiImages);
            analysis = JSON.stringify(parsed);
            // 视觉分析里 article 字段就是纯文章正文——用它作 content
            if (parsed.article && parsed.article.trim()) articleText = parsed.article;
          } catch (e) {
            console.warn('[上传归档] VL 视觉分析失败，回退到文本模型：', e.message);
            Utils.toast('视觉解析失败，回退到文本模型…');
            try {
              const parsed2 = await this.callQwenEnglishAnalyze(settings, v.text);
              analysis = parsed2 ? JSON.stringify(parsed2) : '';
              if (parsed2 && parsed2.article) articleText = parsed2.article;
            } catch (e2) {
              console.warn('[上传归档] 英语解析生成失败，仅保存文章：', e2.message);
              Utils.toast('阅读解析生成失败（' + e2.message + '），文章已保存');
            }
          }
        } else if (v.text) {
          // 文本模型兜底
          try {
            Utils.toast('正在生成阅读解析…');
            const parsed = await this.callQwenEnglishAnalyze(settings, v.text);
            analysis = parsed ? JSON.stringify(parsed) : '';
            if (parsed && parsed.article) articleText = parsed.article;
          } catch (e) {
            console.warn('[上传归档] 英语解析生成失败，仅保存文章：', e.message);
            Utils.toast('阅读解析生成失败（' + e.message + '），文章已保存');
          }
        }
        await Store.put('articles', {
          id: Utils.uid(),
          username: user,
          title,
          source: source || '',
          content: articleText,
          imageData,
          aiResponse: analysis,
          wrongQuestions: [],
          createdAt: new Date().toISOString()
        });
        const summaryTxt = (() => {
          try { const p = JSON.parse(analysis); return p.summary || ''; } catch (_) { return ''; }
        })();
        const qCount = (() => {
          try { const p = JSON.parse(analysis); return (p.questions || []).length; } catch (_) { return 0; }
        })();
        let body = `标题：${title}`;
        if (summaryTxt) body += `\n\nAI摘要：\n${summaryTxt}`;
        body += `\n\n英文全文：\n${articleText}`;
        if (qCount) body += `\n\n（已识别 ${qCount} 道题目，可在阅读页查看解析并标注错题）`;
        this.showUploadResult('已归档到【英语文章】' + (analysis ? '（含AI解析）' : ''), body);
        this._afterUploadSuccess();
      } else {
        this.showUploadResult('ℹ️ 未识别为数学题或英语文章',
          `识别内容：\n${v.text || ''}\n\n如需解答，请切换到「智能解答」Tab。`);
        this._afterUploadSuccess();
      }
    } catch (e) {
      let hint = e.message;
      // 文件服务未开启时给出明确指引
      if (/10007|文件服务|FILE_SERVICE/.test(e.message)) {
        hint = 'Bmob 文件服务未开启。\n\n请前往 Bmob 控制台（bmob.cn）→ 应用设置 → 域名管理 → 绑定文件域名。\n\n开启后图片上传会更快更稳定。当前已自动使用备用模式，如果识别仍失败请检查网络或千问 Key 配置。';
      }
      this.showUploadResult('识别失败', hint);
      this._uploadState = 'input';
      if (goBtn) { goBtn.textContent = '识别并归档'; goBtn.disabled = false; }
    }
  },

  _afterUploadSuccess() {
    this._uploadState = 'done';
    const goBtn = document.getElementById('upload-modal-go');
    if (goBtn) { goBtn.textContent = '完成'; goBtn.disabled = false; }
    const addBtn = document.getElementById('upload-add-more');
    if (addBtn) addBtn.style.display = 'none';
  },

  /* ---------- 上传归档弹窗 ---------- */
  openUploadModal() {
    const mask = document.getElementById('upload-modal-mask');
    if (!mask) return;
    if (mask.style.display !== 'flex') {
      mask.style.display = 'flex';
      this._uploadState = 'input';
      this.populateTopicOptions();
      this.populateBookOptions();
      const s = document.getElementById('upload-source'); if (s) s.value = '';
      const er = document.getElementById('upload-error'); if (er) er.value = '';
      const r = document.getElementById('upload-result'); if (r) r.innerHTML = '';
      const goBtn = document.getElementById('upload-modal-go');
      if (goBtn) { goBtn.textContent = '识别并归档'; goBtn.disabled = false; }
      const addBtn = document.getElementById('upload-add-more');
      if (addBtn) addBtn.style.display = '';
    }
    this.refreshUploadPreview();
  },

  closeUploadModal() {
    const mask = document.getElementById('upload-modal-mask');
    if (mask) mask.style.display = 'none';
    this.uploadImages = [];
    this._pendingPanel = null;
    this._uploadState = 'input';
  },

  refreshUploadPreview() {
    const box = document.getElementById('upload-modal-preview');
    if (!box) return;
    box.innerHTML = '';
    (this.uploadImages || []).forEach((src, idx) => {
      const item = document.createElement('div');
      item.className = 'upload-prev-item';
      const img = document.createElement('img');
      img.src = src;
      img.className = 'upload-prev-img';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'upload-prev-del';
      del.textContent = '×';
      del.title = '移除这张';
      del.addEventListener('click', () => {
        this.uploadImages.splice(idx, 1);
        this.refreshUploadPreview();
      });
      item.appendChild(img);
      item.appendChild(del);
      box.appendChild(item);
    });
  },

  populateTopicOptions() {
    const sel = document.getElementById('upload-topic');
    if (!sel) return;
    sel.innerHTML = '<option value="">（自动识别）</option>';
    let topics = [];
    try { topics = MATH_TOPICS.flatMap(g => g.subs); } catch (_) {}
    if (!topics.length) topics = ['行列式', '矩阵', '向量', '线性方程组', '特征值与特征向量', '二次型', '其他'];
    topics.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      sel.appendChild(o);
    });
  },

  populateBookOptions() {
    const sel = document.getElementById('upload-book');
    if (!sel) return;
    sel.innerHTML = '<option value="">（未归档）</option>';
    const books = (typeof MATH_BOOKS !== 'undefined') ? MATH_BOOKS : [];
    books.forEach(b => {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.name;
      sel.appendChild(o);
    });
    const ys = document.getElementById('upload-year');
    if (ys) {
      ys.innerHTML = '<option value="">选择年份</option>';
      const years = (typeof MATH_YEARS !== 'undefined') ? MATH_YEARS : [];
      years.forEach(y => {
        const o = document.createElement('option');
        o.value = y; o.textContent = y + ' 年';
        ys.appendChild(o);
      });
    }
    this._wireUploadBookToggle();
  },

  _wireUploadBookToggle() {
    const bookSel = document.getElementById('upload-book');
    if (!bookSel || bookSel._wired) return;
    bookSel._wired = true;
    bookSel.addEventListener('change', () => {
      const bk = (typeof MATH_BOOKS !== 'undefined') ? MATH_BOOKS.find(b => b.id === bookSel.value) : null;
      const isYear = !!(bk && bk.type === 'year');
      const yearWrap = document.getElementById('upload-year-wrap');
      const topicWrap = document.getElementById('upload-topic-wrap');
      if (yearWrap) yearWrap.style.display = isYear ? '' : 'none';
      if (topicWrap) topicWrap.style.display = isYear ? 'none' : '';
    });
  },

  showUploadResult(title, body) {
    const el = document.getElementById('upload-result');
    if (!el) { Utils.toast(title); return; }
    const html = String(body)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    el.innerHTML = `<div class="result-card"><div class="result-title">${title}</div><div class="result-body">${html}</div></div>`;
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

    input.value = '';
    this.pendingImage = null;
    document.getElementById('answer-clear-img').style.display = 'none';
    this.renderMessages();
    this.showTyping();

    try {
      let visionText = '';
      if (img) {
        // 图片仅本地压缩识别，不存云端（用户需求：只同步解析后的文字）
        Utils.toast('正在识别图片...');
        let aiImg = img;
        for (const [mw, q] of [[800, 0.5], [640, 0.45], [512, 0.4], [400, 0.35]]) {
          aiImg = await Utils.compressImg(aiImg, mw, q);
          if ((aiImg.substring(aiImg.indexOf(',') + 1).length * 0.75) < 15 * 1024) break;
        }
        visionText = await this.callQwenVLOcr(settings, [aiImg]);
        // 不存图片，只同步文字（userMsg.image 保持 null）
        userMsg.image = null;
        const idx = this.messages.findIndex(m => m.id === userMsg.id);
        if (idx >= 0) this.messages[idx].image = null;
      }
      // 图片已在上面置空，此处持久化时不带 base64，符合"只同步解析后文字"的产品设计
      await Store.put('ai_chats', userMsg);
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
      Pet.onLearnReward('ai_chat_per_msg', 1).catch(() => {});

      // 数学内容自动归档 + 记录薄弱点
      if (this.containsMathContent(text || '') || img) {
        try { await this.autoSaveMathQuestion(user, userMsg, response); } catch (e) {
          console.warn('[薄弱点] 自动保存失败（不影响对话）:', e.message);
        }
      }
    } catch (err) {
      this.hideTyping();
      this.showError(err.message);
    }
  },

  /* ---------- 通用千问文本对话：走 proxyFetch，浏览器端经 Bmob 代理（国内可达），App 内直连 ---------- */
  async callQwenChat(settings, messages, taskName, opts = {}) {
    const url = `${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
    const model = opts.model || 'qwen-max';
    const maxTokens = opts.maxTokens || 2000;
    try {
      const res = await this.proxyFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.qwenKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
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

  /* ---------- 千问文本：英语阅读解析（纯文章正文 + 概括 + 逐题答案） ---------- */
  async callQwenEnglishAnalyze(settings, text) {
    const messages = [
      { role: 'system', content: '你是考研英语二阅读老师。针对用户提供的英语内容（可能含文章正文和阅读理解题目），请输出严格 JSON：\n' +
        '{\n' +
        '  "summary": "用中文概括文章主旨与段落结构（2-4句）",\n' +
        '  "article": "纯文章正文（必须从用户提供的 text 中提取，剔除所有题目、题号、选项 A./B./C./D.、题号 21./22./23. 等干扰项；保留完整段落、不要添油加醋、不要翻译成中文；若用户提供的 text 里看不到独立文章段落只有题目，请填空字符串 \"\"）",\n' +
        '  "questions": [\n' +
        '    {\n' +
        '      "no": "题号，如 21、22、(A)、(B)",\n' +
        '      "question": "题干原文（保持完整，仅题干，不要把选项 A/B/C/D 的文字也塞进来）",\n' +
        '      "options": ["A. fair","B. ample","C. trustworthy","D. recommendable"],\n' +
        '      "answer": "正确选项（如 \"C\" 或 \"C. trustworthy\"），必须明确唯一",\n' +
        '      "explanation": "解析：为何选它、各干扰项错在哪。不要重复题干和选项文字，不要把文章段落塞进来，只针对本题做解析。"\n' +
        '    }\n' +
        '  ]\n' +
        '}\n' +
        '请保证：\n' +
        '1) questions 按题目在原文中出现顺序排列；\n' +
        '2) article 字段必须是「纯净的文章正文」，与 questions 完全不重叠，绝不能含题目/题号/选项；\n' +
        '3) explanation 字段仅针对本题，绝不能复制文章段落；\n' +
        '4) 若 text 中无题目，questions 返回空数组 []；\n' +
        '只返回 JSON，不要任何额外文字、解释、Markdown 代码块。' },
      { role: 'user', content: text }
    ];
    const raw = await this.callQwenChat(settings, messages, '千问英语解析');
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      return JSON.parse(m ? m[0] : raw);
    } catch (e) {
      return { summary: raw, article: '', questions: [] };
    }
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

  async requestQwen(settings, content, taskName, maxTokens = 2000) {
    const url = `${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
    try {
      const res = await this.proxyFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.qwenKey}` },
        body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content }], max_tokens: maxTokens })
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

  async callQwenVLClassify(settings, images) {
    const imgs = Array.isArray(images) ? images : [images];
    const content = [
      ...imgs.map(i => ({ type: 'image_url', image_url: { url: i } })),
      { type: 'text', text: '请仔细识别图片中的内容（多张图按顺序排列，可能是同一道题/文章的不同部分）。先判断类型，再逐字提取原文，最后以 JSON 返回（只返回 JSON，不要任何额外文字或解释）：\n' +
        `{"type":"math|english|other","topic":"若为数学题请填知识点(${this.topicListForVL()})","errorHint":"若图片中可见明显错误原因请简述，否则为空字符串","text":"逐字提取图片中的题目或文章原文。数学公式和符号必须用可读的纯文字表达（例如：λx₁+x₂+x₃=λ-3、矩阵A=[1 λ; -2 1]、行列式|A|），绝对不要输出LaTeX代码（不要\\left、\\begin{array}、\\lambda等LaTeX标记），不要用任何特殊格式，就是普通文字。【重要】请忽略以下非正文内容，不要提取到text中：页眉页脚（如"第X页"、"Page X"、年份+科目+"试题/试卷"等试卷标题）、水印、来源标注、二维码、装订线文字。只提取题目和文章本身的实际内容。"}` }
    ];
    const raw = await this.requestQwen(settings, content, '千问VL识别', 4000);
    return this.parseJSON(raw);
  },

  /* ---------- 千问VL：仅识图提取文字（用于解答链路） ---------- */
  async callQwenVLOcr(settings, images) {
    const imgs = Array.isArray(images) ? images : [images];
    const content = [
      ...imgs.map(i => ({ type: 'image_url', image_url: { url: i } })),
      { type: 'text', text: '请识别图片中的题目或内容，提取完整文字。数学公式用可读纯文字表达（如 λx₁+x₂=3、矩阵A=[1 2; 3 4]），不要输出LaTeX代码（\\left、\\begin等），不要解答。忽略页眉页脚（如"第X页"、"Page X"、年份+科目+"试题/试卷"等试卷标题）、水印、来源标注等非正文内容，只提取题目本身。' }
    ];
    return await this.requestQwen(settings, content, '千问VL识图', 3000);
  },

  parseJSON(raw) {
    if (raw == null) return { type: 'other', topic: '', errorHint: '', text: '' };
    if (typeof raw === 'object') return raw;
    try {
      // 1) 优先匹配 ```json ... ``` 围栏
      const fence = String(raw).match(/```json\s*([\s\S]*?)```/i);
      if (fence) return JSON.parse(fence[1].trim());
      // 2) 取第一个 {...} 块
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      return { type: 'other', topic: '', errorHint: '', text: String(raw) };
    } catch (e) {
      return { type: 'other', topic: '', errorHint: '', text: String(raw) };
    }
  },

  // 严格解析：失败返回 null（用于结构化必须成功的链路，如英语解析）
  parseJSONStrict(raw) {
    if (raw == null) return null;
    if (typeof raw === 'object') return raw;
    try {
      const fence = String(raw).match(/```json\s*([\s\S]*?)```/i);
      if (fence) return JSON.parse(fence[1].trim());
      const m = String(raw).match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      return null;
    } catch (e) {
      return null;
    }
  },

  /* ---------- 千问VL：英语阅读整图分析（多图：文章+题目混合，qwen-vl-max 直出结构化 JSON） ---------- */
  async callQwenEnglishAnalyzeVL(settings, images) {
    const imgs = Array.isArray(images) ? images : [images];
    const MAX_TOTAL = 33 * 1024; // Bmob aiProxy 限制 40KB，给 JSON 留余量
    let totalBytes = 0;
    const validImgs = [];
    for (const raw of imgs) {
      const b64 = (typeof raw === 'string') ? raw.replace(/^data:[^;]+;base64,/, '') : '';
      const bytes = Math.ceil((b64.length || 0) * 0.75);
      if (totalBytes + bytes > MAX_TOTAL) break;
      totalBytes += bytes;
      const url = /^data:/.test(raw) ? raw : 'data:image/jpeg;base64,' + raw;
      validImgs.push(url);
    }
    if (!validImgs.length) throw new Error('图片过大或为空，跳过视觉分析');

    const sysPrompt =
      '你是考研英语二阅读老师。用户上传了 ' + validImgs.length + ' 张图，按上传顺序排列（可能是「文章正文」与「阅读理解题目」混合，先后顺序不定）。请逐图阅读，自行区分哪部分是文章、哪部分是题目。' +
      '请逐字阅读所有图片，输出严格 JSON（不要任何额外文字、不要 Markdown 代码块、不要解释）：\n' +
      '{\n' +
      '  "summary": "用中文概括文章主旨与段落结构（2-4 句）",\n' +
      '  "article": "纯文章正文（无论出现在第几张图中，只提取纯文章段落，剔除所有题号、题干、选项 A./B./C./D.）。【逐字完整转录】：必须按原图段落顺序拼接、用换行分隔段落；不得意译、不得添加原文没有的内容、更不得省略或截断任何句子——即使文章很长也要一次性完整输出。保留英文原文，不要翻译。",\n' +
      '  "questions": [\n' +
      '    {\n' +
      '      "no": "题号，如 21、22、(A)、(B)",\n' +
      '      "question": "题干原文（仅题干，不要把 A/B/C/D 选项文字也塞进来）",\n' +
      '      "options": ["A. ...","B. ...","C. ...","D. ..."],\n' +
      '      "answer": "正确选项（如 C 或 C. xxx），唯一明确",\n' +
      '      "explanation": "解析：为何选它、各干扰项错在哪。不要重复题干，不要复制文章段落。"\n' +
      '    }\n' +
      '  ]\n' +
      '}\n' +
      '【强约束】\n' +
      '1) 输出必须是合法 JSON（双引号、无尾逗号、无注释）；\n' +
      '2) article 与 questions 互不重叠——article 中绝不能含题号/题干/选项文字；\n' +
      '3) explanation 不得复制文章段落，只针对本题解析；\n' +
      '4) questions 数组按原图题号顺序；\n' +
      '5) 若图中没有题目，questions 返回 []；若图中没有文章，article 返回 ""；\n' +
      '6) 只返回 JSON 对象本体，不要任何前后缀文字。';

    const userContent = [
      ...validImgs.map(u => ({ type: 'image_url', image_url: { url: u } })),
      { type: 'text', text: '请按系统指令严格输出 JSON。' }
    ];

    const url = `${settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/chat/completions`;
    const res = await this.proxyFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${settings.qwenKey}` },
      body: JSON.stringify({
        model: 'qwen-vl-max',
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 6000,
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      let detail = '';
      try { const j = JSON.parse(txt); detail = j.error?.message || j.message || ''; } catch (_) {}
      throw new Error('千问VL英语解析：' + (detail || ('HTTP ' + res.status)));
    }
    const data = await res.json();
    const raw = data.choices[0].message.content;
    console.log('[VL英语解析] raw.len=' + String(raw || '').length + ' preview=' + String(raw || '').slice(0, 200));
    const parsed = this.parseJSONStrict(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('VL 返回非结构化 JSON：' + String(raw).slice(0, 120));
    }
    if (typeof parsed.article !== 'string') parsed.article = '';
    if (!Array.isArray(parsed.questions)) parsed.questions = [];
    if (typeof parsed.summary !== 'string') parsed.summary = '';
    console.log('[VL英语解析] OK article=' + parsed.article.length + ' questions=' + parsed.questions.length);
    return parsed;
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

  /* ---------- 数学内容检测 ---------- */
  containsMathContent(text) {
    const mathKeywords = ['矩阵', '行列式', '向量', '方程组', '特征值', '二次型', '积分', '导数', '极限', '微分',
      'matrix', 'determinant', 'vector', 'eigenvalue', 'derivative', 'integral', '题目', '求解', '证明'];
    return mathKeywords.some(kw => text.includes(kw));
  },

  /* ---------- 自动保存数学题 + 记录薄弱点 ---------- */
  async autoSaveMathQuestion(username, userMsg, aiResponse) {
    // 自动识别知识点（从 MATH_TOPICS 或回退到固定列表）
    let topics = [];
    if (typeof MATH_TOPICS !== 'undefined') {
      topics = MATH_TOPICS.flatMap(g => g.subs);
    }
    if (topics.length === 0) {
      topics = ['行列式', '矩阵', '向量', '线性方程组', '特征值与特征向量', '二次型'];
    }
    const fullText = (userMsg.content + ' ' + aiResponse);
    const detectedTopic = topics.find(t => fullText.includes(t)) || '未分类';

    // 存入题库
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

    // 写入薄弱点（按日期+知识点记录）
    const today = new Date().toISOString().slice(0, 10);
    await Store.put('math_weak_points', {
      id: Utils.uid(),
      username,
      topic: detectedTopic,
      questionId: userMsg.id,
      count: 1,
      date: today,
      lastReview: new Date().toISOString()
    });
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
