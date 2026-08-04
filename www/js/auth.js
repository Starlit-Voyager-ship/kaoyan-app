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
      // 规范账号名：优先由「影子账号 → 规范名」反向映射得出（多端一致），
      // 避免 web 端把 currentUser 记成影子账号后查错库。
      const canonical = this.canonicalFromCloudUser(Bmob.username) || Bmob.username;
      Bmob.dataUserId = canonical;
      Store.setCurrentUser(canonical);
      this.cloudOk = true;
      this.enterApp(canonical);
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

  // 由云端登录账号反查规范账号名：扫描 localStorage 的 cloud_user_* 映射，
  // 若某条映射的值正好等于当前云端账号，则其键（去掉前缀）即规范名。
  // 例：cloud_user_123 = 123_msb7wtet，且当前云端账号为 123_msb7wtet → 返回 "123"。
  // 多端一致的关键：数据与规范名绑定，而非随各设备影子账号漂移。
  canonicalFromCloudUser(cloudUser) {
    if (!cloudUser) return null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('cloud_user_') === 0 && localStorage.getItem(k) === cloudUser) {
          return k.slice('cloud_user_'.length);
        }
      }
    } catch (e) { /* localStorage 不可用时忽略 */ }
    return null;
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

    document.getElementById('mine-logout-btn').addEventListener('click', () => {
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
    // sidebar 已移除，跳过侧边栏头像/名称更新
    app.updateHomeStats();
    app.initAllModules();
    // 登录成功后立即刷新云端状态栏
    if (window.FriendWake) {
      setTimeout(() => FriendWake.updateNetStatus(), 300);
    }
  },

  // ---- 登录：只走云端 ----
  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = (document.getElementById('login-password').value || '').trim();
    const errorEl = document.getElementById('login-error');

    console.log('[Auth] 🔐 handleLogin() 开始 | user:', username, 'pwd长度:', password.length);

    if (!username || !password) {
      errorEl.textContent = '请输入账号和密码';
      return;
    }

    // 检查是否有映射的云端账号名
    const cloudUser = localStorage.getItem('cloud_user_' + username) || username;

    try {
      // Step 1: 尝试用云端账号登录
      console.log('[Auth] → Step1 云端登录:', cloudUser, '| API:', (window.Bmob && Bmob.apiUrl) || 'N/A');
      const loginData = await Bmob.login(cloudUser, password);
      console.log('[Auth] ✅ 云端登录成功:', JSON.stringify(loginData));
      this.cloudOk = true;
      Bmob.dataUserId = username; // 数据统一归属规范账号名
      if (cloudUser !== username) localStorage.setItem('cloud_user_' + username, cloudUser);
      errorEl.textContent = '';
      this.enterApp(username);
      Utils.toast(`欢迎回来，${username}！云端同步已开启`);

      return;
    } catch (e) {
      console.warn('[Auth] ❌ Step1 云端登录失败:', e.message, '| status:', e.status, '| name:', e.name);
      console.warn('[Auth]    完整错误对象:', JSON.stringify(e).substring(0, 300));

      // Step 2: 账号不存在/密码不对 → 用原用户名尝试注册
      if (/202|101|NotFound|found|不正确|incorrect/i.test(e.message) || [202, 101, 404].includes(e.status)) {
        try {
          console.log('[Auth] → 尝试注册原用户名:', username);
          await Bmob.register(username, password);
          this.cloudOk = true;
          Bmob.dataUserId = username;
          errorEl.textContent = '';
          this.enterApp(username);
          Utils.toast(`欢迎，${username}！已开通云同步`);
          this._ensurePet(username);
          return;
        } catch (regErr) {
          console.warn('[Auth] 注册失败:', regErr.message, '→ 尝试后缀账号');
        }
      }

      // Step 3: 原用户名不行 → 用后缀账号
      const fixed = await this._fixCloudAccount(username, password, errorEl);
      if (fixed) return;

      // Step 4: 全部失败 → 自动创建全新云端账号（时间戳后缀，保证唯一）
      console.log('[Auth] → 所有常规方式失败，创建全新云端账号...');
      const tsAccount = username + '_' + Date.now().toString(36);
      try {
        await Bmob.register(tsAccount, password);
        localStorage.setItem('cloud_user_' + username, tsAccount);
        Bmob.username = username; // Step4 未自动回写，这里显式把数据归属设回规范名
        Bmob.dataUserId = username;
        this.cloudOk = true;
        errorEl.textContent = '';
        this.enterApp(username);
        Utils.toast(`欢迎，${username}！已自动开通云同步`);
        this._ensurePet(username);
        return;
      } catch (e4) {
        console.error('[Auth] ❌ 创建新账号也失败:', e4.message);
      }

      // 真的全部失败了
      errorEl.textContent = '云端登录失败（账号存在但密码不对）。请用「注册」 tab 创建新账号，或换一个账号登录。';
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
        Bmob.dataUserId = localName;
        localStorage.setItem('cloud_user_' + localName, cloudName);
        this.cloudOk = true;
        errorEl.textContent = '';
        this.enterApp(localName);
        Utils.toast(`欢迎，${localName}！云端同步已开启`);

        return true;
      } catch (_) {
        try {
          await Bmob.register(cloudName, password);
          Bmob.username = localName;
          Bmob.dataUserId = localName;
          localStorage.setItem('cloud_user_' + localName, cloudName);
          this.cloudOk = true;
          errorEl.textContent = '';
          this.enterApp(localName);
          Utils.toast(`欢迎，${localName}！已开通云同步`);
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
      Bmob.dataUserId = username;
      errorEl.textContent = '';
      this.enterApp(username);
      Utils.toast(`注册成功！欢迎 ${username}（云同步已开启）`);
    } catch (e) {
      console.warn('[Auth] 云端注册失败:', e.message);
      if (/already|exist|taken/i.test(e.message)) {
        errorEl.textContent = '该账号已被注册';
      } else {
        errorEl.textContent = '注册失败：' + (e.message || '网络错误');
      }
    }
  },

  handleLogout() {
    Bmob.logout();
    Store.logout();
    document.getElementById('app-page').classList.remove('active');
    // sidebar & overlay 已移除，无需清理

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
