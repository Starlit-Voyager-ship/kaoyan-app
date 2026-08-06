/* ========================================
   主应用控制器 - 路���/初始化/协调
   ======================================== */

// 全部业务数据表（Store 同步链路），导出/清空共用
const DATA_TABLES = [
  'pomodoro_records', 'pomo_tasks', 'pomo_todos', 'ai_chats',
  'vocab_words', 'vocab_known', 'vocab_plan', 'learn_progress',
  'daily_checkin', 'vocab_streak',
  'articles', 'sentences', 'essays',
  'math_questions', 'math_weak_points',
  'reports', 'coins', 'coin_log', 'pet_data', 'pet_pos', 'countdown'
];

const app = {
  currentPage: 'home',

  async init() {
    console.log('考研学习助手 启动中...');

    // 初始化数据存储
    await Store.init();

    // 初始化认证系统（含会话有效性校验）
    await Auth.init();

    // 升级自定义控件（日期 pill / 下拉），替代 Android WebView 原生 UI
    Widgets.init();

    // 挂载桌面宠物（在所有内容层之上，可拖拽、漫游）
    PetUI.mount();

    // 绑定全局导航
    this.bindGlobalEvents();

    // 设置页面标题
    document.title = '考研学习助手';

    console.log('应用初始化完成');
  },

  bindGlobalEvents() {
    // 底部 Tab 主导航
    document.querySelectorAll('.tab-item').forEach(t => {
      t.addEventListener('click', () => this.navigate(t.dataset.tab, { fromTab: true }));
    });

    // 「我的」页内功能行导航（设置等子页，设置走 page-settings）
    document.querySelectorAll('.mine-row[data-page]').forEach(row => {
      row.addEventListener('click', () => this.navigate(row.dataset.page));
    });

    // API Key保存
    document.getElementById('save-api-keys').addEventListener('click', () => this.saveApiSettings());

    // 数据导出
    document.getElementById('export-data').addEventListener('click', () => this.exportData());

    // 数据清除
    document.getElementById('clear-data').addEventListener('click', () => this.clearDataConfirm());
  },

  navigate(page, opts) {
    opts = opts || {};
    const fromTab = !!opts.fromTab;

    // 底部 Tab 高亮（仅来自 Tab 点击时切换）
    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', fromTab && t.dataset.tab === page);
    });

    // 切换内容区域
    document.querySelectorAll('.content-section').forEach(section => {
      section.classList.remove('active');
    });
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) {
      targetPage.classList.add('active');
    }

    this.currentPage = page;

    // 页面特定初始化
    this.onPageEnter(page);
  },

  onPageEnter(page) {
    switch (page) {
      case 'home':
        this.updateHomeStats();
        if (typeof PetUI !== 'undefined' && PetUI.updateHomeCard) PetUI.updateHomeCard();
        if (typeof Countdown !== 'undefined' && Countdown.renderHome) Countdown.renderHome();
        if (typeof DailyQuote !== 'undefined' && DailyQuote.render) DailyQuote.render();
        break;
      case 'mine':
        this.renderMine();
        break;
      case 'vocab':
        // 不自动开始：用户必须主动点「开始背单词」才进入学习状态
        Vocabulary.renderVocabList('all');
        Vocabulary.renderWrongList();
        if (typeof Vocabulary._syncLearningMode === 'function') Vocabulary._syncLearningMode();
        break;
      case 'articles':
        Articles.renderList();
        break;
      case 'sentences':
        Sentences.renderList();
        break;
      case 'essay':
        EssayModule.renderList();
        break;
      case 'math-bank':
        MathBank.render();
        break;
      case 'math-weak':
        WeakPoints.render();
        break;
      case 'ai-assistant':
        AIAssistant.checkConfig();
        break;
      case 'pomodoro':
        Pomodoro.loadTodayStats();
        break;
      case 'reports':
        Reports.init();
        break;
      case 'friend-wake':
        FriendWake.loadBinding();
        break;
      case 'pet':
        PetUI.openPanel();
        break;
      case 'settings':
        this.loadSettingsUI();
        break;
    }
  },

  initAllModules() {
    // 登录后一次性初始化所有模块
    Pomodoro.init();
    AIAssistant.init();
    Vocabulary.init();
    Articles.init();
    Sentences.init();
    EssayModule.init();
    MathBank.init();
    WeakPoints.init();
    Reports.init();
    FriendWake.init();

    if (typeof PetUI !== 'undefined' && PetUI.mount) PetUI.mount();
    this.updateHomeStats();
    if (typeof PetUI !== 'undefined' && PetUI.updateHomeCard) PetUI.updateHomeCard();
    if (typeof Countdown !== 'undefined' && Countdown.renderHome) Countdown.renderHome();
    if (typeof DailyQuote !== 'undefined' && DailyQuote.render) DailyQuote.render();
  },

  async updateHomeStats() {
    const user = Store.getCurrentUser();
    if (!user) return;

    const todayMin = await Store.getTodayFocusMinutes(user);
    const todayWords = await Store.getTodayWordCount(user);
    const todayMath = await Store.getTodayMathCount(user);
    const todayChats = await Store.getTodayChatCount(user);

    document.getElementById('home-focus-today').textContent = todayMin + 'min';
    document.getElementById('home-words-today').textContent = todayWords;
    document.getElementById('home-math-today').textContent = todayMath;
    const chatsEl = document.getElementById('home-chats-today');
    if (chatsEl) chatsEl.textContent = todayChats;

    // 继续学习引导卡：今日专注进度（目标可调，默认 120 分钟）
    const goalMin = parseInt(localStorage.getItem('focus_goal_min') || '120', 10) || 120;
    const pct = Math.min(Math.round((todayMin / goalMin) * 100), 100);
    const progEl = document.getElementById('home-focus-progress');
    if (progEl) progEl.style.width = pct + '%';
    const metaEl = document.getElementById('home-focus-meta');
    if (metaEl) metaEl.textContent = todayMin + ' / ' + goalMin + ' min';
    const cmpEl = document.getElementById('home-focus-compare');
    if (cmpEl) cmpEl.textContent = todayMin > 0 ? ('已专注 ' + todayMin + ' 分钟，继续加油') : '开启今天的专注吧';
    // 同步更新标题中的数字
    const goalEditEl = document.getElementById('home-focus-goal-edit');
    if (goalEditEl) goalEditEl.textContent = goalMin;

    // 单词连续打卡火花
    const streakInfo = (typeof Vocabulary !== 'undefined') ? Vocabulary.getStreakInfo() : { streak: 0, sparkOn: false };
    const sv = document.getElementById('home-streak-value');
    if (sv) sv.textContent = (streakInfo.streak || 0) + ' 天';
    const spark = document.getElementById('home-streak-spark');
    if (spark) {
      spark.classList.toggle('spark-on', !!streakInfo.sparkOn);
      spark.classList.toggle('spark-off', !streakInfo.sparkOn);
    }
  },

  // 点击铅笔图标修改专注目标
  editFocusGoal() {
    const current = parseInt(localStorage.getItem('focus_goal_min') || '120', 10) || 120;
    Utils.showModal('设置今日专注目标', `
      <div style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
        <label style="font-size:0.85rem;color:var(--text-secondary)">每日专注目标（分钟）</label>
        <input id="focus-goal-input" type="text" inputmode="numeric" value="${current}"
               class="setting-input" style="width:100%" placeholder="1-999">
      </div>
    `, `
      <button class="btn-primary" id="focus-goal-save">保存</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);
    document.getElementById('focus-goal-save').onclick = () => {
      const val = document.getElementById('focus-goal-input').value.trim();
      const n = parseInt(val, 10);
      if (!n || n < 1 || n > 999) { Utils.toast('请输入 1-999 之间的数字'); return; }
      localStorage.setItem('focus_goal_min', String(n));
      Utils.hideModal();
      this.updateHomeStats(); // 立即刷新显示
      Utils.toast('专注目标已设为 ' + n + ' 分钟');
    };
  },

  async renderMine() {
    const user = Store.getCurrentUser();
    if (!user) return;
    const nameEl = document.getElementById('mine-username');
    if (nameEl) nameEl.textContent = user;
    const avatarEl = document.getElementById('mine-avatar');
    if (avatarEl) avatarEl.textContent = (user || '?').charAt(0).toUpperCase();
  },

  async saveApiSettings() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user) || {};

    settings.qwenKey = document.getElementById('setting-qwen-key').value.trim();
    settings.qwenBase = document.getElementById('setting-qwen-base').value.trim() || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    Store.saveSettings(user, settings);

    const msgEl = document.getElementById('api-save-msg');
    msgEl.textContent = 'API配置已保存';
    msgEl.className = 'success-msg';

    AIAssistant.checkConfig();
    Utils.toast('设置已保存');

    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  },

  loadSettingsUI() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user) || {};

    document.getElementById('setting-qwen-key').value = settings.qwenKey || '';
    document.getElementById('setting-qwen-base').value = settings.qwenBase || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  },

  async exportData() {
    const user = Store.getCurrentUser();
    const data = { username: user, exportedAt: new Date().toISOString(), tables: {} };

    for (const table of DATA_TABLES) {
      data.tables[table] = await Store.getUserData(table, user);
    }
    // 好友叫醒走独立 WakeStore 链路
    if (window.WakeStore) {
      try {
        data.tables.WakeBind = (await WakeStore.query('WakeBind', { fromUser: user }))
          .concat(await WakeStore.query('WakeBind', { toUser: user }));
        data.tables.WakeMsg = (await WakeStore.query('WakeMsg', { fromUser: user }))
          .concat(await WakeStore.query('WakeMsg', { toUser: user }));
      } catch (e) {
        console.warn('[导出] 好友叫醒数据读取失败', e);
      }
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kaoyan_backup_${Utils.today()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    Utils.toast('数据导出成功！');
  },

  clearDataConfirm() {
    Utils.showModal('危险操作', `
      <p style="color:var(--danger);font-weight:600">此操作将清除你的所有学习数据，包括：</p>
      <ul style="margin:12px 0 12px 20px;color:var(--text-secondary)">
        <li>所有专注记录</li>
        <li>AI对话历史</li>
        <li>单词学习进度</li>
        <li>文章/长难句/作文</li>
        <li>数学题库和错题</li>
        <li>奖励金币数据</li>
        <li>好友绑定关系</li>
      </ul>
      <p style="color:var(--danger)">此操作不可撤销！</p>
    `, `
      <button class="btn-danger" id="confirm-clear-all">确认全部清除</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);

    document.getElementById('confirm-clear-all').onclick = async () => {
      const user = Store.getCurrentUser();
      for (const table of DATA_TABLES) {
        const items = await Store.getUserData(table, user);
        for (const item of items) {
          await Store.delete(table, item.id);
        }
      }
      // 好友叫醒独立数据（Bmob WakeBind/WakeMsg + 本地绑定/游标）
      if (window.WakeStore) {
        try {
          await WakeStore.remove('WakeBind', { fromUser: user });
          await WakeStore.remove('WakeBind', { toUser: user });
          await WakeStore.remove('WakeMsg', { fromUser: user });
          await WakeStore.remove('WakeMsg', { toUser: user });
        } catch (e) {
          console.warn('[清空] 好友叫醒数据清理失败', e);
        }
        try {
          localStorage.removeItem('wake_binding');
          localStorage.removeItem('wake_lastts_' + user);
        } catch (e) {}
      }
      Utils.hideModal();
      Utils.toast('所有数据已清除');
      Auth.handleLogout();
    };
  }
};

// ---- 启动应用 ----
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
