/* ========================================
   单词背诵模块
   总词表按来源区分：
     source = 'dict'    -> 背单词板块背的词（词源：考研大纲词典 EN_DICT）
     source = 'reading' -> 阅读中点词翻译收录的词
   ======================================== */

const Vocabulary = {
  // 背单词队列与状态（队列模型：答完一个shift一个，不认识/部分认识回插队尾）
  queue: [],
  studiedCount: 0,
  reviewDone: 0,
  newDone: 0,
  initialCount: 0,
  GROUP_SIZE: 10,
  showingMeaning: false,
  sessionSeconds: 0,
  sessionTimer: null,
  currentSource: 'all',

  // 测试 session
  testQuestions: [],
  testIndex: 0,
  testCorrect: 0,
  testWrong: 0,
  testMode: null,
  testAnswered: false,

  // 艾宾浩斯复习间隔（天）：学完后的第 1/2/4/7/15/30/60 天复习
  EBBINGHAUS: [1, 2, 4, 7, 15, 30, 60],

  init() {
    this.bindEvents();
    this.renderVocabList('all', 'all');
  },

  // 阅读中点词翻译加入单词：来源标记为 reading
  async addWord(word, meaning, phonetic) {
    if (!word) return;
    const user = Store.getCurrentUser();
    const existing = await Store.getUserData('vocab_words', user);
    // 同词不重复收录（无论来源）
    if (existing.some(w => w.word === word)) return;
    await Store.put('vocab_words', {
      id: `word_${user}_${word}`,
      username: user,
      word,
      phonetic: phonetic || '',
      meaning: meaning || '',
      example: '',
      mastery: 0,
      wrongCount: 0,
      lastReview: null,
      firstLearned: null, // 阅读词不计入「今日新词」统计
      isWrong: false,
      source: 'reading'
    });
    Utils.toast('已加入单词本（阅读）：' + word);
    const vocabPage = document.getElementById('page-vocab');
    if (vocabPage && vocabPage.classList.contains('active')) {
      this.renderVocabList('all', this.currentSource);
    }
  },

  bindEvents() {
    // Tab切换
    document.querySelectorAll('.vocab-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // 从词汇表进入背单词
    document.getElementById('vocab-start-btn').addEventListener('click', () => {
      this.switchTab('learn');
      this.startLearning();
    });

    // 单词操作
    document.getElementById('word-know').addEventListener('click', () => this.markKnown());
    document.getElementById('word-forget').addEventListener('click', () => this.markUnknown());

    // 点击卡片 / 发音 / 太简单
    document.getElementById('word-study-card').addEventListener('click', (e) => {
      if (e.target.closest('#word-speaker') || e.target.closest('#word-too-easy')) return;
      this.showMeaning();
    });
    document.getElementById('word-speaker').addEventListener('click', (e) => {
      e.stopPropagation();
      this.speakCurrent();
    });
    document.getElementById('word-too-easy').addEventListener('click', (e) => {
      e.stopPropagation();
      this.markTooEasy();
    });

    // 测试模式：今日背诵词 / 阅读词
    document.querySelectorAll('.test-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.test-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.startTest(btn.dataset.mode);
      });
    });

    // 词汇表「时间」筛选
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderVocabList(btn.dataset.filter, this.currentSource);
      });
    });

    // 词汇表「来源」筛选
    document.querySelectorAll('.src-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.src-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentSource = btn.dataset.source;
        this.renderVocabList('all', this.currentSource);
      });
    });

    // 搜索
    document.getElementById('vocab-search-input').addEventListener('input',
      Utils.debounce(() => this.renderVocabList('all', this.currentSource), 300));
  },

  switchTab(tabName) {
    document.querySelectorAll('.vocab-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    document.querySelectorAll('.vocab-panel').forEach(p => p.classList.toggle('active', p.id === 'vocab-' + tabName));
    if (tabName === 'all') this.renderVocabList('all', this.currentSource);
    if (tabName === 'wrong') this.renderWrongList();
  },

  // ---------- 背单词：艾宾浩斯选词 ----------
  async startLearning() {
    const user = Store.getCurrentUser();
    const all = await Store.getUserData('vocab_words', user);
    const dictLearned = all.filter(w => (w.source || 'reading') === 'dict');

    // 1) 复习词：按遗忘曲线到期排序，取 150
    const review = this.pickReviewWords(dictLearned, 150);
    // 2) 新词：从词典取未背过的，取 50
    const newOnes = this.pickNewWords(all, 50);

    // 构建队列：每条词记录来源(isNew)、初始序号(用于分组显示)、本次失败次数 failCount
    // 后台按 10 个一组组织；答完一个 shift 一个；不认识/部分认识回插队尾(后续还会出现)
    const queue = [];
    let idx = 0;
    [...review, ...newOnes].forEach(w => {
      const isNew = !w.firstLearned;
      queue.push({
        rec: w,
        isNew,
        initialIndex: idx++,
        failCount: 0
      });
    });

    this.queue = queue;
    this.initialCount = queue.length;
    this.studiedCount = 0;
    this.reviewDone = 0;
    this.newDone = 0;
    this.showingMeaning = false;
    this.sessionSeconds = 0;
    this.startSessionTimer();

    if (this.queue.length === 0) {
      document.getElementById('current-word').textContent = '暂时没有可背的单词';
      return;
    }

    this.showCurrentWord();
    this.updateStudyStats();
  },

  // 从已背过的词里挑「到期」复习的（超期越久越优先）
  pickReviewWords(learned, limit) {
    const today = Utils.today();
    const cands = learned
      .filter(w => w.firstLearned) // 已经学过的
      .map(w => {
        const base = w.lastReview || w.firstLearned;
        const gap = this.daysBetween(base, today);
        const stage = Math.min(w.ebbinghausStage || 0, this.EBBINGHAUS.length - 1);
        const due = this.EBBINGHAUS[stage];
        return { w, overdue: gap - due, stage };
      })
      .filter(x => x.overdue >= 0) // 已到期的
      .sort((a, b) => b.overdue - a.overdue); // 越超期越先背
    return cands.slice(0, limit).map(x => x.w);
  },

  // 从词典挑未背过的新词
  pickNewWords(all, limit) {
    const user = Store.getCurrentUser();
    const dictSet = new Set(
      all.filter(w => (w.source || 'reading') === 'dict').map(w => w.word)
    );
    const dictAll = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const newOnes = [];
    for (const word in dictAll) {
      if (newOnes.length >= limit) break;
      if (dictSet.has(word)) continue; // 已背过
      newOnes.push({
        id: `word_${user}_${word}`,
        username: user,
        word,
        phonetic: '',
        meaning: dictAll[word],
        example: '',
        mastery: 0,
        wrongCount: 0,
        lastReview: null,
        firstLearned: null, // 学到时由 mark 设置
        isWrong: false,
        source: 'dict',
        ebbinghausStage: 0
      });
    }
    return newOnes;
  },

  daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00');
    const db = new Date(b + 'T00:00:00');
    return Math.floor((db - da) / 86400000);
  },

  startSessionTimer() {
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    this.sessionTimer = setInterval(() => {
      this.sessionSeconds++;
      const el = document.getElementById('study-time');
      if (el) el.textContent = Math.floor(this.sessionSeconds / 60) + 'min';
    }, 60000);
  },

  stopSessionTimer() {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  },

  updateStudyStats() {
    const reviewEl = document.getElementById('study-review-count');
    const newEl = document.getElementById('study-new-count');
    if (reviewEl) reviewEl.textContent = `${Math.min(this.reviewDone || 0, 150)}/150`;
    if (newEl) newEl.textContent = `${Math.min(this.newDone || 0, 50)}/50`;
  },

  speakCurrent() {
    if (!this.queue || this.queue.length === 0) return;
    const w = this.queue[0].rec;
    if ('speechSynthesis' in window && w && w.word) {
      const u = new SpeechSynthesisUtterance(w.word);
      u.lang = 'en-US';
      window.speechSynthesis.speak(u);
    }
  },

  async markTooEasy() {
    if (!this.queue || this.queue.length === 0) return;
    const item = this.queue.shift();
    const w = item.rec;
    this.studiedCount++;
    w.mastery = 100;
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    w.ebbinghausStage = this.EBBINGHAUS.length - 1; // 不再安排复习
    await Store.put('vocab_words', w);
    if (item.isNew) this.newDone++;
    else this.reviewDone++;
    this.updateStudyStats();
    this.showCurrentWord();
  },

  showCurrentWord() {
    if (!this.queue || this.queue.length === 0) {
      this.finishSession();
      return;
    }
    const item = this.queue[0];
    const w = item.rec;
    document.getElementById('current-word').textContent = w.word;
    document.getElementById('word-phonetic').textContent = w.phonetic || '';
    document.getElementById('word-meaning').textContent = w.meaning;
    document.getElementById('word-example').textContent = w.example ? `"${w.example}"` : '';
    document.getElementById('word-meaning').style.display = 'none';
    document.getElementById('word-example').style.display = 'none';

    const tagEl = document.getElementById('word-study-tag');
    const hintEl = document.getElementById('word-study-hint');
    if (tagEl) tagEl.textContent = item.isNew ? '新词' : '复习单词';
    if (hintEl) hintEl.style.display = 'block';
    this.showingMeaning = false;

    // 进度：按 10 个一组显示当前组；待学剩余随队列缩短而减少
    const group = Math.floor(item.initialIndex / this.GROUP_SIZE) + 1;
    const totalGroups = Math.ceil(this.initialCount / this.GROUP_SIZE);
    const shown = item.failCount > 0 ? ` · 已错${item.failCount}次` : '';
    document.getElementById('word-progress-text').textContent =
      `第${group}/${totalGroups}组 · 待学 ${this.queue.length}${shown}`;
    const denom = this.studiedCount + this.queue.length;
    const pct = denom > 0 ? (this.studiedCount / denom) * 100 : 0;
    document.getElementById('word-progress-fill').style.width = `${pct}%`;
  },

  showMeaning() {
    if (this.showingMeaning || !this.queue || this.queue.length === 0) return;
    this.showingMeaning = true;
    document.getElementById('word-meaning').style.display = 'block';
    document.getElementById('word-example').style.display = 'block';
    const hintEl = document.getElementById('word-study-hint');
    if (hintEl) hintEl.style.display = 'none';
  },

  // 点击「我认识」：failCount 为 0 才算真正掌握(不再回插)；
  // 失败过则认识一次抵消一次，回插队尾直到 failCount 归零才毕业
  async markKnown() {
    if (!this.queue || this.queue.length === 0) return;
    const item = this.queue.shift();
    const w = item.rec;
    this.studiedCount++;

    if (item.failCount === 0) {
      await this._recordKnown(w, item.isNew, false);
      if (item.isNew) this.newDone++;
      else this.reviewDone++;
    } else {
      item.failCount--;
      this.queue.push(item); // 回插队尾：后续还会出现
      await this._recordKnown(w, item.isNew, true);
    }
    this.updateStudyStats();
    this.showCurrentWord();
  },

  // 点击「不认识」：failCount+1，回插队尾(后续还会出现)；出现次数随失败次数增多
  async markUnknown() {
    if (!this.queue || this.queue.length === 0) return;
    const item = this.queue.shift();
    const w = item.rec;
    this.studiedCount++;
    item.failCount++;
    this.queue.push(item); // 回插队尾：本轮后续还会出现

    w.wrongCount = (w.wrongCount || 0) + 1;
    w.mastery = Math.max(0, (w.mastery || 0) - 10);
    w.isWrong = true;
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    w.ebbinghausStage = 0; // 重置复习阶段
    await Store.put('vocab_words', w);

    // 加金币：每个新单词+2金币
    const user = Store.getCurrentUser();
    await Store.addCoins(user, 2);

    this.updateStudyStats();
    this.showCurrentWord();
  },

  // 真正掌握：推进复习阶段、记首次学习
  async _recordKnown(w, isNew, partial) {
    w.mastery = Math.min(100, (w.mastery || 0) + 20);
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    if (!isNew && !partial) {
      w.ebbinghausStage = Math.min((w.ebbinghausStage || 0) + 1, this.EBBINGHAUS.length - 1);
    }
    await Store.put('vocab_words', w);
  },

  finishSession() {
    this.stopSessionTimer();
    document.getElementById('current-word').textContent = `本轮完成！共学习 ${this.studiedCount} 次`;
    document.getElementById('word-phonetic').textContent = '';
    document.getElementById('word-meaning').style.display = 'none';
    document.getElementById('word-example').style.display = 'none';
    document.getElementById('word-progress-text').textContent = '今日已背完';
    document.getElementById('word-progress-fill').style.width = '100%';
    const tagEl = document.getElementById('word-study-tag');
    if (tagEl) tagEl.textContent = '完成';

    if (typeof app !== 'undefined' && app.updateHomeStats) app.updateHomeStats();
    Utils.toast(`本次学习完成！认识 ${this.reviewDone + this.newDone} 个，需复习 ${this.studiedCount - this.reviewDone - this.newDone} 个`);
  },

  // ---------- 词汇表 / 错词本 ----------
  async renderVocabList(filter, sourceFilter) {
    sourceFilter = sourceFilter || 'all';
    const user = Store.getCurrentUser();
    let words = await Store.getUserData('vocab_words', user);
    const search = (document.getElementById('vocab-search-input').value || '').toLowerCase();

    if (sourceFilter !== 'all') {
      words = words.filter(w => (w.source || 'reading') === sourceFilter);
    }
    if (filter === 'today') {
      const today = Utils.today();
      words = words.filter(w => w.firstLearned === today);
    }
    if (search) {
      words = words.filter(w =>
        w.word.toLowerCase().includes(search) ||
        (w.meaning || '').includes(search)
      );
    }

    const list = document.getElementById('vocab-list');
    list.innerHTML = '';

    if (words.length === 0) {
      list.innerHTML = '<p class="empty-hint">暂无单词</p>';
      return;
    }

    words.forEach(w => {
      const item = document.createElement('div');
      item.className = 'vocab-item';
      const src = w.source === 'reading'
        ? '<span class="vocab-src reading">阅读</span>'
        : '<span class="vocab-src dict">背诵</span>';
      item.innerHTML = `
        <div>
          <span class="vocab-word-text">${this.esc(w.word)}</span>
          <span style="margin-left:8px;color:var(--text-light);font-size:0.82rem">${this.esc(w.phonetic || '')}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;max-width:60%">
          <span class="vocab-word-meaning">${this.esc(w.meaning)}</span>
          ${src}
        </div>
      `;
      list.appendChild(item);
    });
  },

  async renderWrongList() {
    const user = Store.getCurrentUser();
    const words = await Store.getUserData('vocab_words', user);
    // 错词本收录两类：背单词错词 + 阅读错词
    const wrongWords = words.filter(w => w.isWrong && w.wrongCount > 0);

    const list = document.getElementById('wrong-word-list');
    list.innerHTML = '';

    if (wrongWords.length === 0) {
      list.innerHTML = '<p class="empty-hint">暂无错词，继续加油！</p>';
      return;
    }

    wrongWords.forEach(w => {
      const item = document.createElement('div');
      item.className = 'wrong-item';
      const src = w.source === 'reading'
        ? '<span class="wrong-src">阅读</span>'
        : '<span class="wrong-src">背诵</span>';
      item.innerHTML = `<span class="word">${this.esc(w.word)} - ${this.esc(w.meaning)}</span><span class="wrong-meta"><span class="wrong-count">错${w.wrongCount}次</span>${src}</span>`;
      list.appendChild(item);
    });
  },

  // ---------- 单词测试 ----------
  async startTest(mode) {
    this.testMode = mode;
    const user = Store.getCurrentUser();
    const all = await Store.getUserData('vocab_words', user);
    let pool = [];
    if (mode === 'today_dict') {
      const today = Utils.today();
      pool = all.filter(w =>
        (w.source || 'reading') === 'dict' &&
        (w.firstLearned === today || w.lastReview === today)
      );
      if (pool.length === 0) { Utils.toast('今天还没背单词，先去背~'); return; }
    } else if (mode === 'reading') {
      pool = all.filter(w => (w.source || 'reading') === 'reading');
      if (pool.length === 0) { Utils.toast('还没有阅读单词，去阅读时点词翻译吧~'); return; }
    }
    this.testQuestions = this.buildTestQuestions(pool, all, 20);
    if (this.testQuestions.length === 0) { Utils.toast('暂无可用题目'); return; }
    this.testIndex = 0;
    this.testCorrect = 0;
    this.testWrong = 0;
    this.renderTestQuestion();
  },

  // 给每个候选词生成一道「给英文选中文」选择题，配 3 个干扰项
  buildTestQuestions(pool, all, max) {
    const meaningPool = all.map(w => w.meaning).filter(Boolean);
    const questions = [];
    const picked = this.shuffle(pool.slice()).slice(0, max);
    for (const w of picked) {
      const correct = w.meaning;
      const opts = [correct];
      let guard = 0;
      while (opts.length < 4 && guard < 60) {
        guard++;
        const r = meaningPool[Math.floor(Math.random() * meaningPool.length)];
        if (r && !opts.includes(r)) opts.push(r);
      }
      questions.push({
        word: w.word,
        phonetic: w.phonetic,
        correct,
        options: this.shuffle(opts),
        ref: w
      });
    }
    return questions;
  },

  renderTestQuestion() {
    const area = document.getElementById('test-area');
    if (this.testIndex >= this.testQuestions.length) {
      this.renderTestResult();
      return;
    }
    const q = this.testQuestions[this.testIndex];
    this.testAnswered = false;
    const total = this.testQuestions.length;
    const optionsHtml = q.options.map((opt, i) =>
      `<button class="test-option" data-val="${this.esc(opt)}">${this.esc(opt)}</button>`
    ).join('');
    area.innerHTML = `
      <div class="test-progress-info">
        <span>第 ${this.testIndex + 1} / ${total} 题</span>
        <span>对 ${this.testCorrect} · 错 ${this.testWrong}</span>
      </div>
      <div class="test-progress-bar"><div class="progress-fill" style="width:${(this.testIndex / total) * 100}%"></div></div>
      <div class="test-question">
        <div class="test-question-word">${this.esc(q.word)}</div>
        ${q.phonetic ? `<div style="color:var(--text-light);margin-bottom:12px">${this.esc(q.phonetic)}</div>` : ''}
        <div style="color:var(--text-secondary);font-size:0.9rem">选择正确的释义</div>
      </div>
      <div class="test-options">${optionsHtml}</div>
    `;
    area.querySelectorAll('.test-option').forEach(btn => {
      btn.addEventListener('click', () => this.onTestAnswer(btn));
    });
  },

  async onTestAnswer(btn) {
    if (this.testAnswered) return;
    this.testAnswered = true;
    const q = this.testQuestions[this.testIndex];
    const chosen = btn.dataset.val;
    const correct = q.correct;
    if (chosen === correct) {
      btn.classList.add('correct');
      this.testCorrect++;
    } else {
      btn.classList.add('wrong');
      // 标出正确项
      document.querySelectorAll('#test-area .test-option').forEach(b => {
        if (b.dataset.val === correct) b.classList.add('correct');
      });
      this.testWrong++;
      // 错词写入错词本（两类模式统一收录）
      const w = Object.assign({}, q.ref);
      w.wrongCount = (w.wrongCount || 0) + 1;
      w.isWrong = true;
      w.lastReview = Utils.today();
      await Store.put('vocab_words', w);
    }
    setTimeout(() => {
      this.testIndex++;
      this.renderTestQuestion();
    }, 900);
  },

  renderTestResult() {
    const area = document.getElementById('test-area');
    const total = this.testQuestions.length;
    const rate = total ? Math.round((this.testCorrect / total) * 100) : 0;
    area.innerHTML = `
      <div style="text-align:center;padding:30px 0">
        <div style="font-size:2.4rem;font-weight:700;color:var(--primary)">${rate}%</div>
        <p style="margin:12px 0;color:var(--text-secondary)">本次 ${total} 题 · 对 ${this.testCorrect} · 错 ${this.testWrong}</p>
        <button class="btn-primary" id="test-again">再来一次</button>
        <button class="btn-secondary" id="test-back" style="margin-left:8px">返回</button>
      </div>`;
    area.querySelector('#test-again').addEventListener('click', () => this.startTest(this.testMode));
    area.querySelector('#test-back').addEventListener('click', () => {
      area.innerHTML = '<p class="test-placeholder">选择测试模式后开始</p>';
    });
  },

  // ---------- 工具 ----------
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },

  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
};

// 暴露为全局，供阅读页点词翻译调用 addWord
window.Vocabulary = Vocabulary;
