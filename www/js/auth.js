/* ========================================
   认证系统 - 纯云端模式（Bmob）
   本地模式已暂时移除，云端跑通后再接回
   ======================================== */

const Auth = {
  cloudReady: false,
  cloudOk: false,

  init() {
    this.bindEvents();
    Bmob.init(window.APP_CONFIG && window.APP_CONFIG.bmob);
    this.cloudReady = Bmob.hasCredentials();

    // ① 有云端 session → 直接进入
    if (this.cloudReady && Bmob.isLoggedIn()) {
      const user = Bmob.username;
      Store.setCurrentUser(user);
      this.cloudOk = true;
      this.enterApp(user);
      return;
    }

    // ② 没有云端 session → 停在登录页（不管有没有本地缓存）
    const cachedUser = Store.getCurrentUser();
    this.showAuthPage();
    if (cachedUser) {
      document.getElementById('login-username').value = cachedUser;
      // 切到登录tab
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
      const loginTab = document.querySelector('.tab-btn[data-tab="login"]');
      const loginPanel = document.getElementById('login-form');
      if (loginTab) loginTab.classList.add('active');
      if (loginPanel) loginPanel.classList.add('active');
    }
  },

  bindEvents() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab + '-form').classList.add('active');
      });
    });

    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    document.getElementById('register-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
      Utils.showModal('确认退出', '确定要退出登录吗？', `
        <button class="btn-danger" id="confirm-logout">退出</button>
        <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
      `);
      document.getElementById('confirm-logout').onclick = () => {
        Utils.hideModal();
        this.handleLogout();
      };
    });
  },

  showAuthPage() {
    document.getElementById('auth-page').classList.add('active');
    document.getElementById('app-page').classList.remove('active');
  },

  enterApp(username) {
    Store.setCurrentUser(username);
    document.getElementById('auth-page').classList.remove('active');
    document.getElementById('app-page').classList.add('active');
    document.getElementById('sidebar-username').textContent = username;
    app.updateHomeStats();
    app.initAllModules();
  },

  // ---- 登录：只走云端 ----
  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      errorEl.textContent = '请输入账号和密码';
      return;
    }

    // 检查是否有映射的云端账号名
    const cloudUser = localStorage.getItem('cloud_user_' + username) || username;

    try {
      // Step 1: 尝试用云端账号登录
      console.log('[Auth] → 云端登录:', cloudUser);
      await Bmob.login(cloudUser, password);
      this.cloudOk = true;
      if (cloudUser !== username) localStorage.setItem('cloud_user_' + username, cloudUser);
      errorEl.textContent = '';
      this.enterApp(username);
      Utils.toast(`欢迎回来，${username}！云端同步已开启 ✅`);
      this._ensurePet(username);
      return;
    } catch (e) {
      console.warn('[Auth] 云端登录失败:', e.message, '| status:', e.status);

      // Step 2: 账号不存在/密码不对 → 用原用户名尝试注册
      if (/202|101|NotFound|found|不正确|incorrect/i.test(e.message) || [202, 101, 404].includes(e.status)) {
        try {
          console.log('[Auth] → 尝试注册原用户名:', username);
          await Bmob.register(username, password);
          this.cloudOk = true;
          errorEl.textContent = '';
          this.enterApp(username);
          Utils.toast(`欢迎，${username}！已开通云同步 ✅`);
          this._ensurePet(username);
          return;
        } catch (regErr) {
          console.warn('[Auth] 注册失败:', regErr.message, '→ 尝试后缀账号');
        }
      }

      // Step 3: 原用户名不行 → 用后缀账号
      const fixed = await this._fixCloudAccount(username, password, errorEl);
      if (fixed) return;

      // 全部失败 → 显示明确错误（不再降级！）
      errorEl.textContent = '云端登录失败：' + (e.message || '请检查网络');
    }
  },

  // ---- 后缀账号修复：原用户名被占时用 _c/_cloud 等后缀 ----
  async _fixCloudAccount(localName, password, errorEl) {
    const suffixes = ['_c', '_cloud', '_2'];
    for (const suffix of suffixes) {
      const cloudName = localName + suffix;
      try {
        console.log('[Auth] → 尝试后缀账号:', cloudName);
        await Bmob.login(cloudName, password);
        Bmob.username = localName; // 数据统一用本地用户名
        localStorage.setItem('cloud_user_' + localName, cloudName);
        this.cloudOk = true;
        errorEl.textContent = '';
        this.enterApp(localName);
        Utils.toast(`欢迎，${localName}！云端同步已开启 ✅`);
        this._ensurePet(localName);
        return true;
      } catch (_) {
        try {
          await Bmob.register(cloudName, password);
          Bmob.username = localName;
          localStorage.setItem('cloud_user_' + localName, cloudName);
          this.cloudOk = true;
          errorEl.textContent = '';
          this.enterApp(localName);
          Utils.toast(`欢迎，${localName}！已开通云同步 ✅`);
          this._ensurePet(localName);
          return true;
        } catch (_) {
          continue;
        }
      }
    }
    return false;
  },

  // ---- 注册：只走云端 ----
  async handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const errorEl = document.getElementById('reg-error');

    if (!username || username.length < 3 || username.length > 16) {
      errorEl.textContent = '账号需3-16位';
      return;
    }
    if (!password || password.length < 6) {
      errorEl.textContent = '密码至少6位';
      return;
    }
    if (password !== password2) {
      errorEl.textContent = '两次密码不一致';
      return;
    }

    try {
      await Bmob.register(username, password);
      this.cloudOk = true;
      errorEl.textContent = '';
      this.enterApp(username);
      Utils.toast(`注册成功！欢迎 ${username}（云同步已开启）`);
      this._ensurePet(username);
    } catch (e) {
      console.warn('[Auth] 云端注册失败:', e.message);
      if (/already|exist|taken/i.test(e.message)) {
        errorEl.textContent = '该账号已被注册';
      } else {
        errorEl.textContent = '注册失败：' + (e.message || '网络错误');
      }
    }
  },

  async _ensurePet(username) {
    const pet = await Store.getPetData(username);
    if (!pet) {
      await Store.savePetData({
        id: `pet_${username}`,
        username,
        claimed: false,
        name: '',
        level: 1,
        exp: 0,
        coins: 0,
        mood: 80,
        hunger: 80,
        thirst: 80,
        petType: 'ameath',
        inventory: { food: 0, water: 0, treat: 0 },
        totalCoinsEarned: 0,
        createdAt: new Date().toISOString()
      });
    }
  },

  handleLogout() {
    Bmob.logout();
    Store.logout();
    DesktopPet.hide();
    document.getElementById('app-page').classList.remove('active');
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');

    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    document.getElementById('login-error').textContent = '';
    document.getElementById('reg-username').value = '';
    document.getElementById('reg-password').value = '';
    document.getElementById('reg-password2').value = '';
    document.getElementById('reg-error').textContent = '';

    this.showAuthPage();
    Utils.toast('已退出登录');
  }
};
