/* ========================================
   主应用控制器 - 路���/初始化/协调
   ======================================== */

const app = {
  currentPage: 'home',

  async init() {
    console.log('🚀 考研学习助手 启动中...');

    // 初始化数据存储
    await Store.init();

    // 初始化认证系统
    Auth.init();

    // 初始化桌宠系统
    DesktopPet.init();

    // 绑定全局导航
    this.bindGlobalEvents();

    // 设置页面标题
    document.title = '考研学习助手';

    console.log('✅ 应用初始化完成');
  },

  bindGlobalEvents() {
    // 菜单切换
    document.getElementById('menu-toggle').addEventListener('click', () => this.toggleSidebar());
    document.getElementById('sidebar-close').addEventListener('click', () => this.closeSidebar());
    document.getElementById('overlay').addEventListener('click', () => this.closeSidebar());

    // 导航项点击
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.addEventListener('click', () => {
        if (item.classList.contains('disabled')) {
          Utils.toast('该模块即将上线，敬请期待！');
          return;
        }
        this.navigate(item.dataset.page);
        this.closeSidebar();
      });
    });

    // 桌宠开关
    document.getElementById('pet-toggle').addEventListener('click', () => {
      DesktopPet.toggle();
    });

    // 用户菜单
    document.getElementById('user-menu-btn').addEventListener('click', () => {
      this.toggleSidebar();
    });

    // 设置页面导航
    document.getElementById('settings-btn').addEventListener('click', () => {
      this.navigate('settings');
      this.closeSidebar();
    });

    // API Key保存
    document.getElementById('save-api-keys').addEventListener('click', () => this.saveApiSettings());

    // 数据导出
    document.getElementById('export-data').addEventListener('click', () => this.exportData());

    // 数据清除
    document.getElementById('clear-data').addEventListener('click', () => this.clearDataConfirm());

    // 宠物名称设置
    document.getElementById('setting-pet-name').addEventListener('change', (e) => {
      if (PetCore.data && PetCore.data.claimed) {
        PetCore.data.name = e.target.value.trim() || PetCore.data.name;
        PetCore.save(); PetCore.render();
      }
    });
  },

  toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('overlay').classList.toggle('show');
  },

  closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
  },

  navigate(page) {
    // 更新导航高亮
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // 切换内容区域
    document.querySelectorAll('.content-section').forEach(section => {
      section.classList.remove('active');
    });
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) {
      targetPage.classList.add('active');
    }

    // 更新标题
    const titles = {
      home: '首页概览',
      pomodoro: '专注计时',
      'ai-assistant': 'AI助理',
      vocab: '单词背诵',
      articles: '文章阅读',
      sentences: '长难句解析',
      essay: '作文模板',
      'math-bank': '数学题库',
      'math-weak': '薄弱错题',
      reports: '学习报表',
      pet: '我的宠物',
      'friend-wake': '好友叫醒',
      settings: '设置'
    };
    document.getElementById('page-title').textContent = titles[page] || '考研学习助手';

    this.currentPage = page;

    // 页面特定初始化
    this.onPageEnter(page);
  },

  onPageEnter(page) {
    switch (page) {
      case 'home':
        this.updateHomeStats();
        break;
      case 'vocab':
        Vocabulary.startLearning();
        Vocabulary.renderVocabList('all');
        Vocabulary.renderWrongList();
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
        MathBank.renderList();
        break;
      case 'math-weak':
        WeakPoints.render();
        break;
      case 'pet':
        PetCore.render();
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
    PetCore.init();
    FriendWake.init();
    DesktopPet.init();

    // 如果已领取宠物且开启了桌宠，显示桌宠
    if (PetCore.data?.claimed) {
      const settings = Store.getSettings(Store.getCurrentUser());
      if (settings.desktopPet !== false) {
        setTimeout(() => DesktopPet.show(), 500);
      }
    }

    this.updateHomeStats();
  },

  async updateHomeStats() {
    const user = Store.getCurrentUser();
    if (!user) return;

    const todayMin = await Store.getTodayFocusMinutes(user);
    const todayWords = await Store.getTodayWordCount(user);
    const todayMath = await Store.getTodayMathCount(user);
    const coins = await Store.getCoins(user);

    document.getElementById('home-focus-today').textContent = todayMin + 'min';
    document.getElementById('home-words-today').textContent = todayWords;
    document.getElementById('home-math-today').textContent = todayMath;
    document.getElementById('home-coins').textContent = coins;

    // 更新宠物预览
    if (PetCore.data) PetCore.render();
  },

  async saveApiSettings() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user);

    settings.deepseekKey = document.getElementById('setting-deepseek-key').value.trim();
    settings.deepseekBase = document.getElementById('setting-deepseek-base').value.trim() || 'https://api.deepseek.com';
    settings.qwenKey = document.getElementById('setting-qwen-key').value.trim();
    settings.qwenBase = document.getElementById('setting-qwen-base').value.trim() || 'https://dashscope.aliyuncs.com/api/v1';
    settings.desktopPet = document.getElementById('setting-desktop-pet').checked;

    if (document.getElementById('setting-pet-name').value.trim()) {
      settings.petName = document.getElementById('setting-pet-name').value.trim();
    }

    Store.saveSettings(user, settings);

    const msgEl = document.getElementById('api-save-msg');
    msgEl.textContent = '✅ API配置已保存';
    msgEl.className = 'success-msg';

    AIAssistant.checkConfig();
    Utils.toast('设置已保存');

    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  },

  loadSettingsUI() {
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user);

    document.getElementById('setting-deepseek-key').value = settings.deepseekKey || '';
    document.getElementById('setting-deepseek-base').value = settings.deepseekBase || 'https://api.deepseek.com';
    document.getElementById('setting-qwen-key').value = settings.qwenKey || '';
    document.getElementById('setting-qwen-base').value = settings.qwenBase || 'https://dashscope.aliyuncs.com/api/v1';
    document.getElementById('setting-desktop-pet').checked = settings.desktopPet !== false;
    document.getElementById('setting-pet-name').value = settings.petName || (PetCore.data?.name || '');
  },

  async exportData() {
    const user = Store.getCurrentUser();
    const data = { username: user, exportedAt: new Date().toISOString(), tables: {} };

    const tables = [
      'pomodoro_records', 'ai_chats', 'vocab_words', 'articles',
      'sentences', 'essays', 'math_questions', 'math_weak_points',
      'pet_data', 'friend_bindings', 'reports'
    ];

    for (const table of tables) {
      data.tables[table] = await Store.getUserData(table, user);
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
    Utils.showModal('⚠️ 危险操作', `
      <p style="color:var(--danger);font-weight:600">此操作将清除你的所有学习数据，包括：</p>
      <ul style="margin:12px 0 12px 20px;color:var(--text-secondary)">
        <li>所有专注记录</li>
        <li>AI对话历史</li>
        <li>单词学习进度</li>
        <li>文章/长难句/作文</li>
        <li>数学题库和错题</li>
        <li>宠物数据和金币</li>
        <li>好友绑定关系</li>
      </ul>
      <p style="color:var(--danger)">此操作不可撤销！</p>
    `, `
      <button class="btn-danger" id="confirm-clear-all">确认全部清除</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);

    document.getElementById('confirm-clear-all').onclick = async () => {
      const user = Store.getCurrentUser();
      const tables = [
        'pomodoro_records', 'ai_chats', 'vocab_words', 'articles',
        'sentences', 'essays', 'math_questions', 'math_weak_points',
        'pet_data', 'friend_bindings', 'reports'
      ];
      for (const table of tables) {
        const items = await Store.getUserData(table, user);
        for (const item of items) {
          await Store.delete(table, item.id);
        }
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
