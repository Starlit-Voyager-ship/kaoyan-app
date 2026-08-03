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
  answerDelay: 2000,    // 翻页停顿(ms)；'manual' 为手动模式(点「下一词」才翻)
  _pendingAnswer: null, // 手动模式：待执行的判定(known/unknown)
  _advancing: false,    // 答案处理中锁，防连点
  _progressId: null,    // 今日进度记录在云端的 id
  graduated: [],        // 今日已毕业(不再出现)的词集合
  completed: false,     // 今日 200 词是否全部背完
  _checkedIn: false,    // 今日是否已打卡
  _checkInTime: null,   // 打卡时间

  // 测试 session
  testQuestions: [],
  testIndex: 0,
  testCorrect: 0,
  testWrong: 0,
  testMode: null,
  testAnswered: false,

  // 过滤熟词测试 session
  filterQuestions: [],
  filterIndex: 0,
  filterCorrect: 0,
  filterWrong: 0,
  filterBand: {},
  _filterAnswered: false,

  // 艾宾浩斯复习间隔（天）：学完后的第 1/2/4/7/15/30/60 天复习
  EBBINGHAUS: [1, 2, 4, 7, 15, 30, 60],

  init() {
    this.bindEvents();
    this._restoreSpeedUI();
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

    // 翻页速度设置
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => this._setSpeed(btn.dataset.speed));
    });
    // 今日打卡
    document.getElementById('word-checkin').addEventListener('click', () => this.checkIn());
    // 过滤熟词（词汇量测试）
    document.getElementById('word-filter-known').addEventListener('click', () => this.startFilterTest());
    // 设置页：管理已过滤熟词
    const mkw = document.getElementById('manage-known-words');
    if (mkw) mkw.addEventListener('click', () => this.openKnownManager());
    // 手动模式「下一词」
    document.getElementById('word-next').addEventListener('click', () => this._advanceManual());

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
    if (tabName === 'learn') { this._restoreSpeedUI(); this._refreshCheckinBtn(); this.refreshFilterTip(); }
  },

  // ---------- 背单词：艾宾浩斯选词 + 进度多端保留 ----------
  async startLearning() {
    const user = Store.getCurrentUser();
    const today = Utils.today();

    // 1) 尝试恢复今日云端进度（刷新网页 / 换手机都从断点继续）
    const restored = await this._loadProgress(user, today);
    if (restored) {
      this.queue = restored.queue;
      this.initialCount = restored.initialCount;
      this.studiedCount = restored.studiedCount;
      this.reviewDone = restored.reviewDone;
      this.newDone = restored.newDone;
      this.graduated = restored.graduated || [];
      this.completed = !!restored.completed;
      this._progressId = restored.id;
      this.showingMeaning = false;
      this.sessionSeconds = 0;
      this.startSessionTimer();
      await this._loadCheckIn();
      this._refreshCheckinBtn();

      if (this.queue.length === 0) {
        this.finishSession();
        return;
      }
      this.showCurrentWord();
      this.updateStudyStats();
      return;
    }

    // 2) 新建今日队列（150 复习 + 50 新词）
    const all = await Store.getUserData('vocab_words', user);
    const dictLearned = all.filter(w => (w.source || 'reading') === 'dict');
    const known = await this.getKnownSet(); // 已过滤的熟词
    const exclude = new Set([...this.graduated, ...known]); // 今日已毕业 + 熟词 都不重复出现
    const review = this.pickReviewWords(dictLearned, 150, exclude);
    const newOnes = this.pickNewWords(all, 50, exclude);

    // 构建队列：每条词记录来源(isNew)、初始序号(分组显示)、失败次数 failCount
    const queue = [];
    let idx = 0;
    [...review, ...newOnes].forEach(w => {
      queue.push({
        rec: w,
        isNew: !w.firstLearned,
        initialIndex: idx++,
        failCount: 0
      });
    });

    this.queue = queue;
    this.initialCount = queue.length;
    this.studiedCount = 0;
    this.reviewDone = 0;
    this.newDone = 0;
    this.graduated = [];
    this.completed = false;
    this._progressId = `learn_${user}_${today}`;
    this.showingMeaning = false;
    this.sessionSeconds = 0;
    this.startSessionTimer();
    await this._loadCheckIn();
    this._refreshCheckinBtn();

    if (this.queue.length === 0) {
      document.getElementById('current-word').textContent = '今天没有需要背的单词啦';
      this._saveProgress();
      return;
    }
    this.showCurrentWord();
    this.updateStudyStats();
    this._saveProgress();
  },

  // 从已背过的词里挑「到期」复习的（超期越久越优先）
  pickReviewWords(learned, limit, exclude) {
    const today = Utils.today();
    const cands = learned
      .filter(w => w.firstLearned) // 已经学过的
      .filter(w => !exclude || !exclude.has(w.word)) // 今天已毕业的不重复
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
  pickNewWords(all, limit, exclude) {
    const user = Store.getCurrentUser();
    const dictSet = new Set(
      all.filter(w => (w.source || 'reading') === 'dict').map(w => w.word)
    );
    const dictAll = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    // 收集所有候选词（未背过、不在排除集合），然后乱序
    const candidates = [];
    for (const word in dictAll) {
      if (dictSet.has(word)) continue;
      if (exclude && exclude.has(word)) continue;
      candidates.push(word);
    }
    // Fisher-Yates 洗牌
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const newOnes = [];
    for (const word of candidates.slice(0, limit)) {
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
    if (this._advancing || !this.queue || this.queue.length === 0) return;
    this._advancing = true;
    this._setActionButtons(true);
    this.showMeaning(); // 先给出意思
    const delay = (typeof this.answerDelay === 'number') ? this.answerDelay : 800;
    setTimeout(() => {
      this._advancing = false;
      this._setActionButtons(false);
      this._doMarkTooEasy();
    }, delay);
  },

  _doMarkTooEasy() {
    if (!this.queue || this.queue.length === 0) return;
    const item = this.queue.shift();
    const w = item.rec;
    this.studiedCount++;
    w.mastery = 100;
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    w.ebbinghausStage = this.EBBINGHAUS.length - 1; // 不再安排复习
    Store.put('vocab_words', w).catch(() => {});
    if (item.isNew) this.newDone++;
    else this.reviewDone++;
    this._addGraduated(w.word);
    this.updateStudyStats();
    this.showCurrentWord();
    this._saveProgress();
  },

  _setActionButtons(disabled) {
    ['word-know', 'word-forget', 'word-too-easy'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
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

  // 点击「我认识」：先给意思，停顿(或手动)后再翻页；failCount 为 0 才算真正掌握(不再回插)；
  // 失败过则认识一次抵消一次，回插队尾直到 failCount 归零才毕业
  async markKnown() {
    if (this._advancing || !this.queue || this.queue.length === 0) return;
    this._advancing = true;
    this._setActionButtons(true);
    this.showMeaning(); // 先给出意思
    if (this.answerDelay === 'manual') {
      this._pendingAnswer = 'known';
      this._enterManualWait();
      return; // 等用户点「下一词」
    }
    setTimeout(() => {
      this._advancing = false;
      this._setActionButtons(false);
      this._doMarkKnown();
    }, this.answerDelay);
  },

  _doMarkKnown() {
    if (!this.queue || this.queue.length === 0) return;
    const item = this.queue.shift();
    const w = item.rec;
    this.studiedCount++;

    if (item.failCount === 0) {
      this._recordKnown(w, item.isNew, false);
      if (item.isNew) this.newDone++;
      else this.reviewDone++;
      this._addGraduated(w.word);
    } else {
      item.failCount--;
      this._recordKnown(w, item.isNew, true);
      if (item.failCount <= 0) {
        this._addGraduated(w.word); // 抵消完，毕业不再出现
      } else {
        this.queue.push(item); // 仍需复习，回插队尾
      }
    }
    this.updateStudyStats();
    this.showCurrentWord();
    this._saveProgress();
  },

  // 点击「不认识」：先给意思，停顿(或手动)后再翻页；failCount+1，回插队尾(后续还会出现)
  async markUnknown() {
    if (this._advancing || !this.queue || this.queue.length === 0) return;
    this._advancing = true;
    this._setActionButtons(true);
    this.showMeaning(); // 先给出意思
    if (this.answerDelay === 'manual') {
      this._pendingAnswer = 'unknown';
      this._enterManualWait();
      return;
    }
    setTimeout(() => {
      this._advancing = false;
      this._setActionButtons(false);
      this._doMarkUnknown();
    }, this.answerDelay);
  },

  _doMarkUnknown() {
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
    Store.put('vocab_words', w).catch(() => {});

    // 加金币：每个新单词+2金币
    const user = Store.getCurrentUser();
    Store.addCoins(user, 2);

    this.updateStudyStats();
    this.showCurrentWord();
    this._saveProgress();
  },

  // 手动模式：判定的词已显示意思，等待用户点「下一词」才翻页
  _enterManualWait() {
    const next = document.getElementById('word-next');
    if (next) next.style.display = 'block';
  },

  _advanceManual() {
    if (!this._pendingAnswer) return;
    const ans = this._pendingAnswer;
    this._pendingAnswer = null;
    const next = document.getElementById('word-next');
    if (next) next.style.display = 'none';
    this._advancing = false;
    this._setActionButtons(false);
    if (ans === 'known') this._doMarkKnown();
    else this._doMarkUnknown();
  },

  _addGraduated(word) {
    if (!this.graduated.includes(word)) this.graduated.push(word);
  },

  // 真正掌握：推进复习阶段、记首次学习
  async _recordKnown(w, isNew, partial) {
    w.mastery = Math.min(100, (w.mastery || 0) + 20);
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    if (!isNew && !partial) {
      w.ebbinghausStage = Math.min((w.ebbinghausStage || 0) + 1, this.EBBINGHAUS.length - 1);
    }
    Store.put('vocab_words', w).catch(() => {});
  },

  // ---------- 进度多端保留（云端 learn_progress）----------
  _progressTable: 'learn_progress',

  async _loadProgress(user, today) {
    try {
      const all = await Store.getUserData(this._progressTable, user);
      const rec = (all || []).find(r => r.date === today && r.username === user);
      if (!rec || !rec.queue) return null;
      const vocabAll = await Store.getUserData('vocab_words', user);
      const queue = rec.queue
        .map(q => ({
          rec: this._rebuildRec(q.word, q.isNew, vocabAll),
          isNew: q.isNew,
          initialIndex: q.initialIndex,
          failCount: q.failCount || 0
        }))
        .filter(x => x.rec);
      return {
        id: rec.id,
        date: rec.date,
        queue,
        initialCount: rec.initialCount || queue.length,
        studiedCount: rec.studiedCount || 0,
        reviewDone: rec.reviewDone || 0,
        newDone: rec.newDone || 0,
        graduated: rec.graduated || [],
        completed: rec.completed || false,
        checkedIn: rec.checkedIn || false,
        checkInTime: rec.checkInTime || null
      };
    } catch (e) {
      return null;
    }
  },

  // 从 vocab_words 或内置词典重建单词记录（恢复进度时用）
  _rebuildRec(word, isNew, vocabAll) {
    const exist = (vocabAll || []).find(w => w.word === word);
    if (exist) return exist;
    const dictAll = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const user = Store.getCurrentUser();
    return {
      id: `word_${user}_${word}`,
      username: user,
      word,
      phonetic: '',
      meaning: dictAll[word] || '',
      example: '',
      mastery: 0,
      wrongCount: 0,
      lastReview: null,
      firstLearned: null,
      isWrong: false,
      source: 'dict',
      ebbinghausStage: 0
    };
  },

  async _saveProgress() {
    if (!this._progressId) return;
    const user = Store.getCurrentUser();
    const today = Utils.today();
    const payload = {
      id: this._progressId,
      username: user,
      date: today,
      queue: this.queue.map(q => ({
        word: q.rec.word,
        isNew: q.isNew,
        initialIndex: q.initialIndex,
        failCount: q.failCount
      })),
      initialCount: this.initialCount,
      studiedCount: this.studiedCount,
      reviewDone: this.reviewDone,
      newDone: this.newDone,
      graduated: this.graduated,
      completed: this.completed,
      checkedIn: this._checkedIn || false,
      checkInTime: this._checkInTime || null
    };
    const p = Store.put(this._progressTable, payload);
    if (p && p.catch) p.catch(() => {});
  },

  // 翻页速度设置（localStorage 偏好，按设备保留）
  _restoreSpeedUI() {
    const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('vocab_answer_delay') : null;
    this.answerDelay = saved ? (saved === 'manual' ? 'manual' : parseInt(saved, 10)) : 2000;
    document.querySelectorAll('.speed-btn').forEach(b => {
      const v = b.dataset.speed;
      const match = (v === 'manual') ? (this.answerDelay === 'manual') : (parseInt(v, 10) === this.answerDelay);
      b.classList.toggle('active', match);
    });
  },

  _setSpeed(speed) {
    this.answerDelay = (speed === 'manual') ? 'manual' : parseInt(speed, 10);
    if (typeof localStorage !== 'undefined') localStorage.setItem('vocab_answer_delay', String(speed));
    document.querySelectorAll('.speed-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.speed === String(speed));
    });
    Utils.toast('翻页速度：' + (speed === 'manual' ? '手动（点「下一词」翻页）' : speed + ' 秒'));
  },

  // 今日打卡（独立每日记录，与背诵进度解耦）
  async checkIn() {
    if (this._checkedIn) { Utils.toast('今天已经打卡啦 ✓'); return; }
    this._checkedIn = true;
    this._checkInTime = new Date().toISOString();
    this._refreshCheckinBtn();
    await this._saveCheckIn();
    Utils.toast('打卡成功，今天继续加油！🎉');
  },

  _checkInTable: 'daily_checkin',

  async _saveCheckIn() {
    const user = Store.getCurrentUser();
    const today = Utils.today();
    const payload = {
      id: `checkin_${user}_${today}`,
      username: user,
      date: today,
      checkInTime: this._checkInTime
    };
    const p = Store.put(this._checkInTable, payload);
    if (p && p.catch) p.catch(() => {});
  },

  async _loadCheckIn() {
    try {
      const user = Store.getCurrentUser();
      const today = Utils.today();
      const all = await Store.getUserData(this._checkInTable, user);
      const rec = (all || []).find(r => r.date === today && r.username === user);
      if (rec) {
        this._checkedIn = true;
        this._checkInTime = rec.checkInTime || null;
      } else {
        this._checkedIn = false;
        this._checkInTime = null;
      }
    } catch (e) {
      this._checkedIn = false;
    }
  },

  _refreshCheckinBtn() {
    const btn = document.getElementById('word-checkin');
    if (!btn) return;
    if (this._checkedIn) {
      btn.textContent = '今日已打卡 ✓';
      btn.classList.add('checked');
      btn.disabled = true;
    } else {
      btn.textContent = '今日打卡';
      btn.classList.remove('checked');
      btn.disabled = false;
    }
  },

  finishSession() {
    this.stopSessionTimer();
    this.completed = true;
    const nextBtn = document.getElementById('word-next');
    if (nextBtn) nextBtn.style.display = 'none';
    document.getElementById('current-word').textContent = `今天背完啦！共 ${this.studiedCount} 次`;
    document.getElementById('word-phonetic').textContent = '';
    document.getElementById('word-meaning').style.display = 'none';
    document.getElementById('word-example').style.display = 'none';
    document.getElementById('word-progress-text').textContent = '今日已背完';
    document.getElementById('word-progress-fill').style.width = '100%';
    const tagEl = document.getElementById('word-study-tag');
    if (tagEl) tagEl.textContent = '完成';

    if (typeof app !== 'undefined' && app.updateHomeStats) app.updateHomeStats();
    const tip = this._checkedIn
      ? `本次学习完成！认识 ${this.reviewDone + this.newDone} 个`
      : `本次学习完成！记得点「今日打卡」哦 📅`;
    Utils.toast(tip);
    this._saveProgress();
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

  // ---------- 过滤熟词（词汇量测试，基于 COCA 词频分层抽样） ----------
  FILTER_BANDS: [
    { name: '高频·很可能认识', min: 1, max: 2500 },
    { name: '中频', min: 2501, max: 6000 },
    { name: '较低频', min: 6001, max: 12000 },
    { name: '低频·考研难词', min: 12001, max: 999999 }
  ],

  // 读取已标记熟词集合（云端 vocab_known 单条记录）
  async getKnownSet() {
    const user = Store.getCurrentUser();
    if (!user) return new Set();
    try {
      const all = await Store.getUserData('vocab_known', user);
      const rec = (all || []).find(r => r.username === user);
      if (rec && Array.isArray(rec.words)) return new Set(rec.words);
    } catch (e) {}
    return new Set();
  },

  // 保存熟词集合（覆盖式写入单条记录）
  async saveKnownSet(set) {
    const user = Store.getCurrentUser();
    if (!user) return;
    const payload = { id: `known_${user}`, username: user, words: [...set] };
    const p = Store.put('vocab_known', payload);
    if (p && p.catch) p.catch(() => {});
  },

  // 词汇量测试：按词频带分层抽样，4 选 1 考义
  async startFilterTest() {
    const dict = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const freq = (typeof window !== 'undefined' && window.WORD_FREQ) ? window.WORD_FREQ : {};
    const known = await this.getKnownSet();

    // 1) 按词频带分组（排除已标记熟词）
    const byBand = {};
    this.FILTER_BANDS.forEach(b => byBand[b.name] = []);
    for (const word in dict) {
      if (known.has(word)) continue;
      const rank = freq[word] || 99999;
      const band = this.FILTER_BANDS.find(b => rank >= b.min && rank <= b.max) || this.FILTER_BANDS[3];
      byBand[band.name].push({ word, meaning: dict[word], rank });
    }

    // 2) 每带打乱后抽 10 个（分层抽样）
    const PER = 10;
    const meaningPool = Object.values(dict).filter(Boolean);
    const questions = [];
    this.FILTER_BANDS.forEach(b => {
      const sample = this.shuffle(byBand[b.name].slice()).slice(0, PER);
      sample.forEach(p => {
        const opts = [p.meaning];
        let g = 0;
        while (opts.length < 4 && g < 80) {
          g++;
          const r = meaningPool[Math.floor(Math.random() * meaningPool.length)];
          if (r && !opts.includes(r)) opts.push(r);
        }
        questions.push({
          word: p.word,
          phonetic: '',
          correct: p.meaning,
          options: this.shuffle(opts),
          rank: p.rank,
          bandName: b.name
        });
      });
    });
    if (questions.length === 0) { Utils.toast('没有可测试的词，可能已过滤完'); return; }

    this.filterQuestions = questions;
    this.filterIndex = 0;
    this.filterCorrect = 0;
    this.filterWrong = 0;
    this.filterBand = {};
    this._filterAnswered = false;
    this.switchTab('test');
    this.renderFilterQuestion();
  },

  renderFilterQuestion() {
    const area = document.getElementById('test-area');
    if (this.filterIndex >= this.filterQuestions.length) {
      this.renderFilterResult();
      return;
    }
    const q = this.filterQuestions[this.filterIndex];
    const total = this.filterQuestions.length;
    const optionsHtml = q.options.map(opt =>
      `<button class="test-option" data-val="${this.esc(opt)}">${this.esc(opt)}</button>`
    ).join('');
    area.innerHTML = `
      <div class="test-progress-info">
        <span>第 ${this.filterIndex + 1} / ${total} 题 · 词汇量测试</span>
        <span>对 ${this.filterCorrect} · 错 ${this.filterWrong}</span>
      </div>
      <div class="test-progress-bar"><div class="progress-fill" style="width:${(this.filterIndex / total) * 100}%"></div></div>
      <div class="test-question">
        <div class="test-question-word">${this.esc(q.word)}</div>
        <div style="color:var(--text-secondary);font-size:0.9rem">选择正确的释义（${this.esc(q.bandName)}）</div>
      </div>
      <div class="test-options">${optionsHtml}</div>
    `;
    area.querySelectorAll('.test-option').forEach(btn => {
      btn.addEventListener('click', () => this.onFilterAnswer(btn));
    });
  },

  async onFilterAnswer(btn) {
    if (this._filterAnswered) return;
    this._filterAnswered = true;
    const q = this.filterQuestions[this.filterIndex];
    const chosen = btn.dataset.val;
    const correct = q.correct;
    const bn = q.bandName;
    if (!this.filterBand[bn]) this.filterBand[bn] = { total: 0, correct: 0 };
    this.filterBand[bn].total++;
    if (chosen === correct) {
      btn.classList.add('correct');
      this.filterCorrect++;
      this.filterBand[bn].correct++;
    } else {
      btn.classList.add('wrong');
      document.querySelectorAll('#test-area .test-option').forEach(b => {
        if (b.dataset.val === correct) b.classList.add('correct');
      });
      this.filterWrong++;
    }
    setTimeout(() => {
      this._filterAnswered = false;
      this.filterIndex++;
      this.renderFilterQuestion();
    }, 900);
  },

  async renderFilterResult() {
    const area = document.getElementById('test-area');
    const total = this.filterQuestions.length;
    const rate = total ? Math.round((this.filterCorrect / total) * 100) : 0;

    // 估算断点：按难度带顺序，准确率 >= 0.6 的最高带上限作为 cutoff
    let cutoffRank = 0;
    this.FILTER_BANDS.forEach(b => {
      const r = this.filterBand[b.name];
      if (r && r.total > 0 && r.correct / r.total >= 0.6) {
        cutoffRank = Math.max(cutoffRank, b.max);
      }
    });

    const dict = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const freq = (typeof window !== 'undefined' && window.WORD_FREQ) ? window.WORD_FREQ : {};
    const known = await this.getKnownSet();
    let toFilter = 0;
    for (const word in dict) {
      if (known.has(word)) continue;
      const rank = freq[word] || 99999;
      if (rank <= cutoffRank) toFilter++;
    }
    const bandsText = this.FILTER_BANDS.map(b => {
      const r = this.filterBand[b.name];
      const acc = r && r.total ? Math.round((r.correct / r.total) * 100) : '-';
      return `${b.name}: ${acc}%`;
    }).join(' ｜ ');

    area.innerHTML = `
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:2.2rem;font-weight:700;color:var(--primary)">${rate}%</div>
        <p style="margin:10px 0;color:var(--text-secondary);font-size:0.85rem">${bandsText}</p>
        <p style="margin:14px 0;font-size:0.95rem">预估词汇量约 <b>${cutoffRank === 0 ? '较低' : cutoffRank}</b> 词（COCA 频率）</p>
        <p style="margin:6px 0 18px;color:var(--text-secondary)">将过滤 <b style="color:var(--primary)">${toFilter}</b> 个熟词，背单词不再出现它们</p>
        <button class="btn-primary" id="filter-apply">应用过滤</button>
        <button class="btn-secondary" id="filter-again" style="margin-left:8px">再测一次</button>
        <button class="btn-secondary" id="filter-cancel" style="margin-left:8px">取消</button>
      </div>`;
    area.querySelector('#filter-apply').addEventListener('click', async () => {
      await this._applyFilterKnown(cutoffRank);
      area.innerHTML = '<p class="test-placeholder">已过滤熟词！去「背单词」开始学习吧</p>';
      this.refreshFilterTip();
    });
    area.querySelector('#filter-again').addEventListener('click', () => this.startFilterTest());
    area.querySelector('#filter-cancel').addEventListener('click', () => {
      area.innerHTML = '<p class="test-placeholder">选择测试模式后开始</p>';
    });
  },

  async _applyFilterKnown(cutoffRank) {
    const dict = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const freq = (typeof window !== 'undefined' && window.WORD_FREQ) ? window.WORD_FREQ : {};
    const known = await this.getKnownSet();
    for (const word in dict) {
      const rank = freq[word] || 99999;
      if (rank <= cutoffRank) known.add(word);
    }
    await this.saveKnownSet(known);
    Utils.toast(`已过滤 ${known.size} 个熟词 🎉`);
  },

  async refreshFilterTip() {
    const tip = document.getElementById('filter-known-tip');
    if (!tip) return;
    const known = await this.getKnownSet();
    tip.textContent = known.size > 0 ? `已过滤 ${known.size} 个熟词` : '';
  },

  // 设置页：查看/恢复已过滤熟词
  async openKnownManager() {
    const known = await this.getKnownSet();
    const dict = (typeof window !== 'undefined' && window.EN_DICT) ? window.EN_DICT : {};
    const words = [...known].sort();
    if (words.length === 0) {
      Utils.showModal('已过滤熟词', '<p class="empty-hint">还没有过滤任何熟词。去背单词页点「过滤熟词（词汇量测试）」吧。</p>', '<button class="btn-secondary" onclick="Utils.hideModal()">关闭</button>');
      return;
    }
    const items = words.map(w =>
      `<div class="known-item">
        <span class="known-word">${this.esc(w)}</span>
        <span class="known-meaning">${this.esc(dict[w] || '')}</span>
        <button class="known-restore" data-word="${this.esc(w)}">恢复</button>
      </div>`
    ).join('');
    const body = `<div class="known-list">${items}</div><p class="setting-tip">共 ${words.length} 个熟词</p>`;
    const footer = `<button class="btn-secondary" id="known-restore-all">全部恢复</button><button class="btn-secondary" onclick="Utils.hideModal()">关闭</button>`;
    Utils.showModal('已过滤熟词', body, footer);
    document.querySelectorAll('#modal-body .known-restore').forEach(btn => {
      btn.addEventListener('click', async () => {
        const w = btn.dataset.word;
        const ks = await this.getKnownSet();
        ks.delete(w);
        await this.saveKnownSet(ks);
        btn.closest('.known-item').remove();
        Utils.toast('已恢复：' + w);
        this.refreshFilterTip();
      });
    });
    const allBtn = document.getElementById('known-restore-all');
    if (allBtn) allBtn.addEventListener('click', async () => {
      await this.saveKnownSet(new Set());
      Utils.hideModal();
      Utils.toast('已恢复全部熟词');
      this.refreshFilterTip();
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
