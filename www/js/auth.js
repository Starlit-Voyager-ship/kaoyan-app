/* ========================================
   认证系统 - 登录/注册/登出
   云端(Bmob)优先 + 本地(IndexedDB)自动降级
   ======================================== */

const Auth = {
  MAX_USERS: 5,
  cloudReady: false,
  cloudOk: false,    // 云端实际可用（首次成功调用后设为 true）
  useLocal: false,   // 是否正在使用本地模式

  init() {
    this.bindEvents();
    Bmob.init(window.APP_CONFIG && window.APP_CONFIG.bmob);
    this.cloudReady = Bmob.hasCredentials();

    // ① 有云端会话 → 直接进入云端模式
    if (this.cloudReady && Bmob.isLoggedIn()) {
      const user = Bmob.username;
      Store.setCurrentUser(user);
      this.enterApp(user, false);
      return;
    }

    // ② 有本地缓存用户
    const cachedUser = Store.getCurrentUser();
    if (cachedUser) {
      if (this.cloudReady) {
        // ★ 有Bmob凭证但没云端session → 停在登录页，预填用户名，强制走云端登录（云端失败才降级本地）
        this.showAuthPage();
        // 预填用户名，方便用户直接输密码
        document.getElementById('login-username').value = cachedUser;
        // 切到登录tab
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
        const loginTab = document.querySelector('.tab-btn[data-tab="login"]');
        const loginPanel = document.getElementById('login-form');
        if (loginTab) loginTab.classList.add('active');
        if (loginPanel) loginPanel.classList.add('active');
        // 提示一下
        setTimeout(() => {
          Utils.toast('请重新登录以开启云端同步 ↑', 3000);
        }, 500);
      } else {
        // 没有Bmob凭证 → 纯本地模式，直接进入
        this.enterApp(cachedUser, false);
      }
    } else {
      // ③ 没有任何用户 → 显示登录页
      this.showAuthPage();
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

  // ---- 登录：先尝试云端，失败自动降级本地 ----
  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      errorEl.textContent = '请输入账号和密码';
      return;
    }

    // 尝试云端登录
    if (this.cloudReady) {
      try {
        await Bmob.login(username, password);
        this.cloudOk = true;
        this.useLocal = false;
        localStorage.removeItem('_cloud_suggested');
        errorEl.textContent = '';
        this.enterApp(username);
        Utils.toast(`欢迎回来，${username}！已开启云同步 ✅`);
        this._ensurePet(username);
        return;
      } catch (e) {
        console.warn('[Auth] 云端登录失败:', e.message);
        // 账号在云端不存在 → 自动注册后再登录（本地老用户无缝上云）
        if (/202|NotFound|found|不正确/i.test(e.message) || (e.status === 202)) {
          console.log('[Auth] 云端账号不存在，尝试自动注册...');
          try {
            await Bmob.register(username, password);
            this.cloudOk = true;
            this.useLocal = false;
            errorEl.textContent = '';
            this.enterApp(username);
            Utils.toast(`欢迎，${username}！已自动开通云同步 ✅`);
            this._ensurePet(username);
            return;
          } catch (regErr) {
            console.warn('[Auth] 自动注册也失败:', regErr.message);
          }
        }
      }
    }

    // 降级：本地登录
    try {
      const user = await Store.getUser(username);
      if (!user) {
        errorEl.textContent = '账号不存在';
        return;
      }
      if (user.password !== Utils.simpleHash(password)) {
        errorEl.textContent = '账号或密码错误';
        return;
      }

      this.useLocal = true;
      errorEl.textContent = '';
      this.enterApp(username);
      Utils.toast(`欢迎回来，${username}！（本地模式）`);
      this._ensurePet(username);
    } catch (e2) {
      errorEl.textContent = '登录失败：' + (e2.message || '未知错误');
    }
  },

  // ---- 注册：先尝试云端，失败自动降级本地 ----
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

    // 尝试云端注册
    if (this.cloudReady) {
      try {
        await Bmob.register(username, password);
        this.cloudOk = true;
        this.useLocal = false;
        errorEl.textContent = '';
        this.enterApp(username);
        Utils.toast(`注册成功！欢迎 ${username}（已开启云同步）`);
        this._ensurePet(username);
        return;
      } catch (e) {
        console.warn('[Auth] 云端注册失败，降级本地:', e.message);
        if (/already|exist/i.test(e.message)) {
          errorEl.textContent = '该账号已被注册';
          return;
        }
        // 其他错误 → 降级本地
      }
    }

    // 降级：本地注册
    const users = await Store.getUsers();
    if (users.length >= this.MAX_USERS) {
      errorEl.textContent = `注册人数已达上限(${this.MAX_USERS}人)`;
      return;
    }
    if (users.find(u => u.username === username)) {
      errorEl.textContent = '该账号已被注册';
      return;
    }

    const newUser = {
      username,
      password: Utils.simpleHash(password),
      inviteCode: Utils.inviteCode(),
      createdAt: new Date().toISOString()
    };

    await Store.saveUser(newUser);

    this.useLocal = true;
    errorEl.textContent = '';
    this.enterApp(username);
    Utils.toast(`注册成功！欢迎 ${username}（本地模式）`);
    this._ensurePet(username);
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
