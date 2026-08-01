/* ========================================
   单词背诵模块
   ======================================== */

const Vocabulary = {
  currentIndex: 0,
  sessionWords: [],
  showingMeaning: false,
  knownIndices: [],
  unknownIndices: [],

  // 考研核心词汇库（示例数据）
  defaultWords: [
    { word: 'abandon', phonetic: '/əˈbændən/', meaning: 'v. 放弃；抛弃', example: 'He abandoned his car in the snow.' },
    { word: 'ability', phonetic: '/əˈbɪləti/', meaning: 'n. 能力；本领', example: 'She has the ability to solve complex problems.' },
    { word: 'abnormal', phonetic: '/æbˈnɔːml/', meaning: 'a. 反常的；不正常的', example: 'abnormal weather conditions' },
    { word: 'abolish', phonetic: '/əˈbɒlɪʃ/', meaning: 'v. 废除；取消', example: 'abolish slavery' },
    { word: 'abstract', phonetic: '/ˈæbstrækt/', meaning: 'a. 抽象的 n. 摘要', example: 'abstract concept' },
    { word: 'academic', phonetic: '/ˌækəˈdemɪk/', meaning: 'a. 学术的；学院的', example: 'academic performance' },
    { word: 'accelerate', phonetic: '/əkˈseləreɪt/', meaning: 'v. 加速；促进', example: 'accelerate economic growth' },
    { word: 'accept', phonetic: '/əkˈsept/', meaning: 'v. 接受；承认', example: 'accept the invitation' },
    { word: 'access', phonetic: '/ˈækses/', meaning: 'n./v. 进入；访问；存取', example: 'have access to the Internet' },
    { word: 'accommodate', phonetic: '/əˈkɒmədeɪt/', meaning: 'v. 容纳；使适应', example: 'accommodate 500 people' },
    { word: 'accompany', phonetic: '/əˈkʌmpəni/', meaning: 'v. 陪伴；伴随', example: 'accompany her to the hospital' },
    { word: 'accomplish', phonetic: '/əˈkʌmplɪʃ/', meaning: 'v. 完成；实现', example: 'accomplish the task' },
    { word: 'accordance', phonetic: '/əˈkɔːdns/', meaning: 'n. 一致；按照', example: 'in accordance with the rules' },
    { word: 'account', phonetic: '/əˈkaʊnt/', meaning: 'n. 账户；描述 v. 解释', example: 'take into account' },
    { word: 'accumulate', phonetic: '/əˈkjuːmjəleɪt/', meaning: 'v. 积累；积聚', example: 'accumulate wealth' },
    { word: 'accurate', phonetic: '/ˈækjərət/', meaning: 'a. 准确的；精确的', example: 'accurate information' },
    { word: 'achieve', phonetic: '/əˈtʃiːv/', meaning: 'v. 达到；完成', example: 'achieve success' },
    { word: 'acknowledge', phonetic: '/əkˈnɒlɪdʒ/', meaning: 'v. 承认；致谢', example: 'acknowledge the truth' },
    { word: 'acquire', phonetic: '/əˈkwaɪə(r)/', meaning: 'v. 获得；学到', example: 'acquire knowledge' },
    { word: 'adapt', phonetic: '/əˈdæpt/', meaning: 'v. 使适应；改编', example: 'adapt to the new environment' },
    { word: 'adequate', phonetic: '/ˈædɪkwət/', meaning: 'a. 充足的；适当的', example: 'adequate supply of water' },
    { word: 'adjust', phonetic: '/əˈdʒʌst/', meaning: 'v. 调整；适应', example: 'adjust the focus' },
    { word: 'administration', phonetic: '/ədˌmɪnɪˈstreɪʃn/', meaning: 'n. 管理；行政', example: 'business administration' },
    { word: 'advocate', phonetic: '/ˈædvəkeɪt/', meaning: 'v./n. 提倡；拥护者', example: 'advocate for change' },
    { word: 'affect', phonetic: '/əˈfekt/', meaning: 'v. 影响；感动', example: 'affect the decision' },
    { word: 'aggressive', phonetic: '/əˈɡresɪv/', meaning: 'a. 侵略的；有进取心的', example: 'aggressive marketing strategy' },
    { word: 'allocate', phonetic: '/ˈæləkeɪt/', meaning: 'v. 分配；拨出', example: 'allocate resources' },
    { word: 'alternative', phonetic: '/ɔːlˈtɜːnətɪv/', meaning: 'n./a. 替代品；可供选择的', example: 'have no alternative' },
    { word: 'ambitious', phonetic: /æmˈbɪʃəs/, meaning: 'a. 有雄心的；有野心的', example: 'an ambitious plan' },
    { word: 'analyze', phonetic: '/ˈænəlaɪz/', meaning: 'v. 分析；分解', example: 'analyze the data' },
    { word: 'anticipate', phonetic: /ænˈtɪsɪpeɪt/, meaning: 'v. 预期；期望', example: 'anticipate problems' },
    { word: 'apparent', phonetic: '/əˈpærənt/', meaning: 'a. 明显的；表面的', example: 'apparent reason' },
    { word: 'appeal', phonetic: '/əˈpiːl/', meaning: 'v./n. 呼吁；吸引；上诉', example: 'appeal to the public' },
    { word: 'application', phonetic: '/ˌæplɪˈkeɪʃn/', meaning: 'n. 申请；应用', example: 'job application' },
    { word: 'approach', phonetic: '/əˈprəʊtʃ/', meaning: 'v./n. 接近；方法', example: 'a new approach to teaching' },
    { word: 'appropriate', phonetic: '/əˈprəʊpriət/', meaning: 'a. 适当的；恰当的', example: 'take appropriate measures' },
    { word: 'approximate', phonetic: '/əˈprɒksɪmət/', meaning: 'a. 大约的；近似的', example: 'approximate number' },
    { word: 'arbitrary', phonetic: '/ɑːrbɪtreri/', meaning: 'a. 任意的；武断的', example: 'arbitrary decision' },
    { word: 'arise', phonetic: '/əˈraɪz/', meaning: 'v. 出现；产生', example: 'problems may arise' },
    { word: 'arrange', phonetic: '/əˈreɪndʒ/', meaning: 'v. 安���；整理', example: 'arrange a meeting' },
    { word: 'artificial', phonetic: '/ˌɑːtɪˈfɪʃl/', meaning: 'a. 人造的；人工的', example: 'artificial intelligence' },
    { word: 'aspect', phonetic: '/ˈæspekt/', meaning: 'n. 方面；层面', example: 'every aspect of life' },
    { word: 'assess', phonetic: '/əˈses/', meaning: 'v. 评估；评价', example: 'assess the situation' },
    { word: 'assign', phonetic: '/əˈsaɪn/', meaning: 'v. 分配；指派', example: 'assign homework' },
    { word: 'assist', phonetic: '/əˈsɪst/', meaning: 'v. 协助；帮助', example: 'assist in the research' },
    { word: 'associate', phonetic: '/əˈsəʊʃieɪt/', meaning: 'v. 联系；联想 n. 同事', example: 'associate with success' },
    { word: 'assume', phonetic: '/əˈsjuːm/', meaning: 'v. 假设；承担', example: 'assume responsibility' },
    { word: 'assure', phonetic: '/əˈʃʊə(r)/', meaning: 'v. 保证；使确信', example: 'assure you of quality' },
    { word: 'attach', phonetic: '/əˈtætʃ/', meaning: 'v. 附上；贴上', example: 'attach a file' },
    { word: 'attain', phonetic: '/əˈteɪn/', meaning: 'v. 达到；获得', example: 'attain the goal' },
    { word: 'attribute', phonetic: '/əˈtrɪbjuːt/', meaning: 'v. 归因于 n. 属性', example: 'attribute success to hard work' }
  ],

  init() {
    this.bindEvents();
    this.initDefaultWords();
  },

  bindEvents() {
    // Tab切换
    document.querySelectorAll('.vocab-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.vocab-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.vocab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('vocab-' + tab.dataset.tab).classList.add('active');
      });
    });

    // 单词操作
    document.getElementById('word-know').addEventListener('click', () => this.markKnown());
    document.getElementById('word-forget').addEventListener('click', () => this.markUnknown());
    document.getElementById('word-show').addEventListener('click', () => this.showMeaning());

    // 测试模式
    document.querySelectorAll('.test-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.test-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // 词汇表筛选
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.renderVocabList(btn.dataset.filter);
      });
    });

    // 搜索
    document.getElementById('vocab-search-input').addEventListener('input',
      Utils.debounce(() => this.renderVocabList('all'), 300));
  },

  async initDefaultWords() {
    const user = Store.getCurrentUser();
    const existing = await Store.getUserData('vocab_words', user);
    if (existing.length === 0) {
      // 初始化默认词库
      for (const w of this.defaultWords) {
        await Store.put('vocab_words', {
          id: `word_${user}_${w.word}`,
          username: user,
          word: w.word,
          phonetic: w.phonetic,
          meaning: w.meaning,
          example: w.example,
          mastery: 0,
          wrongCount: 0,
          lastReview: null,
          firstLearned: null,
          isWrong: false
        });
      }
    }
  },

  async startLearning() {
    const user = Store.getCurrentUser();
    const allWords = await Store.getUserData('vocab_words', user);
    // 筛选需要学习的单词（掌握度低的优先）
    this.sessionWords = allWords
      .sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
      .slice(0, 30);
    this.currentIndex = 0;
    this.knownIndices = [];
    this.unknownIndices = [];
    this.showingMeaning = false;

    if (this.sessionWords.length === 0) {
      document.getElementById('current-word').textContent = '没有待学习的单词';
      return;
    }

    this.showCurrentWord();
  },

  showCurrentWord() {
    if (this.currentIndex >= this.sessionWords.length) {
      this.finishSession();
      return;
    }
    const w = this.sessionWords[this.currentIndex];
    document.getElementById('current-word').textContent = w.word;
    document.getElementById('word-phonetic').textContent = w.phonetic;
    document.getElementById('word-meaning').textContent = w.meaning;
    document.getElementById('word-example').textContent = `"${w.example}"`;
    document.getElementById('word-meaning').style.display = 'none';
    document.getElementById('word-example').style.display = 'none';
    this.showingMeaning = false;

    // 进度
    const total = this.sessionWords.length;
    document.getElementById('word-progress-text').textContent =
      `${this.currentIndex + 1} / ${total}`;
    document.getElementById('word-progress-fill').style.width =
      `${((this.currentIndex + 1) / total) * 100}%`;
  },

  showMeaning() {
    this.showingMeaning = true;
    document.getElementById('word-meaning').style.display = 'block';
    document.getElementById('word-example').style.display = 'block';
  },

  async markKnown() {
    if (this.currentIndex >= this.sessionWords.length) return;
    const w = this.sessionWords[this.currentIndex];
    w.mastery = Math.min(100, (w.mastery || 0) + 15);
    if (!w.firstLearned) w.firstLearned = Utils.today();
    await Store.put('vocab_words', w);
    this.knownIndices.push(this.currentIndex);
    this.currentIndex++;
    this.showCurrentWord();
  },

  async markUnknown() {
    if (this.currentIndex >= this.sessionWords.length) return;
    const w = this.sessionWords[this.currentIndex];
    w.wrongCount = (w.wrongCount || 0) + 1;
    w.mastery = Math.max(0, (w.mastery || 0) - 10);
    w.isWrong = true;
    w.lastReview = Utils.today();
    if (!w.firstLearned) w.firstLearned = Utils.today();
    await Store.put('vocab_words', w);
    this.unknownIndices.push(this.currentIndex);
    this.currentIndex++;

    // 加金币：每个新单词+2金币
    const user = Store.getCurrentUser();
    await Store.addCoins(user, 2);

    this.showCurrentWord();
  },

  finishSession() {
    const total = this.sessionWords.length;
    const known = this.knownIndices.length;
    const unknown = this.unknownIndices.length;
    document.getElementById('current-word').textContent = `本轮完成！✅认识${known} ❌不认识${unknown}`;
    document.getElementById('word-phonetic').textContent = '';
    document.getElementById('word-meaning').style.display = 'none';
    document.getElementById('word-example').style.display = 'none';

    app.updateHomeStats();
    Utils.toast(`本次学习完成！认识${known}个，需复习${unknown}个`);
  },

  async renderVocabList(filter) {
    const user = Store.getCurrentUser();
    let words = await Store.getUserData('vocab_words', user);
    const search = document.getElementById('vocab-search-input').value.toLowerCase();

    if (filter === 'today') {
      const today = Utils.today();
      words = words.filter(w => w.firstLearned === today);
    }
    if (search) {
      words = words.filter(w =>
        w.word.toLowerCase().includes(search) ||
        w.meaning.includes(search)
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
      item.innerHTML = `
        <div>
          <span class="vocab-word-text">${w.word}</span>
          <span style="margin-left:8px;color:var(--text-light);font-size:0.82rem">${w.phonetic}</span>
        </div>
        <span class="vocab-word-meaning">${w.meaning}</span>
      `;
      list.appendChild(item);
    });
  },

  async renderWrongList() {
    const user = Store.getCurrentUser();
    const words = await Store.getUserData('vocab_words', user);
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
      item.innerHTML = `<span class="word">${w.word} - ${w.meaning}</span><span class="wrong-count">错${w.wrongCount}次</span>`;
      list.appendChild(item);
    });
  }
};
