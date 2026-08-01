/* ========================================
   认证系统 - 登录/注册/登出
   ======================================== */

const Auth = {
  MAX_USERS: 5, // 软提示；硬人数限制由 Bmob 端按需配置（避免前端暴露 master key）
  cloudReady: false,

  init() {
    this.bindEvents();
    // Bmob 凭据就绪检查
    Bmob.init(window.APP_CONFIG && window.APP_CONFIG.bmob);
    this.cloudReady = Bmob.hasCredentials();

    // 优先用已保存的云端会话
    if (Bmob.isLoggedIn()) {
      const user = Bmob.username;
      Store.setCurrentUser(user);
      this.enterApp(user, false);
      return;
    }
    // 兼容旧版本地登录（无云端凭据时）
    const user = Store.getCurrentUser();
    if (user) {
      this.enterApp(user, false);
    } else {
      this.showAuthPage();
    }
  },

  bindEvents() {
    // Tab切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab + '-form').classList.add('active');
      });
    });

    // 登录表单
    document.getElementById('login-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleLogin();
    });

    // 注册表单
    document.getElementById('register-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleRegister();
    });

    // 登出
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

  enterApp(username, syncFlag) {
    Store.setCurrentUser(username);
    document.getElementById('auth-page').classList.remove('active');
    document.getElementById('app-page').classList.add('active');
    document.getElementById('sidebar-username').textContent = username;
    app.updateHomeStats();
    app.initAllModules();
  },

  async handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    if (!username || !password) {
      errorEl.textContent = '请输入账号和密码';
      return;
    }

    // 使用 Bmob 云端登录（多端互通）
    if (this.cloudReady) {
      try {
        await Bmob.login(username, password);
        errorEl.textContent = '';
        this.enterApp(username);
        Utils.toast(`欢迎回来，${username}！`);
        this._ensurePet(username);
        return;
      } catch (e) {
        errorEl.textContent = this._errMsg(e, '登录失败');
        return;
      }
    }

    // 无云端凭据：降级本地（仅本机有效）
    errorEl.textContent = '云端未配置，使用本地登录（仅本机）';
    this.enterApp(username);
  },

  async handleRegister() {
    const username = document.getElementById('reg-username').value.trim();
    const password = document.getElementById('reg-password').value;
    const password2 = document.getElementById('reg-password2').value;
    const errorEl = document.getElementById('reg-error');

    // 验证
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

    // Bmob 云端注册（多端互通，数据隔离由 ACL 保证）
    if (this.cloudReady) {
      try {
        await Bmob.register(username, password);
        errorEl.textContent = '';
        this.enterApp(username);
        Utils.toast(`注册成功！欢迎 ${username}`);
        this._ensurePet(username);
        return;
      } catch (e) {
        errorEl.textContent = this._errMsg(e, '注册失败');
        return;
      }
    }

    errorEl.textContent = '云端未配置，无法注册云端账号';
  },

  // 确保宠物数据存在（注册后或登录旧账号首登）
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

  _errMsg(e, prefix) {
    const m = (e && e.message) || '';
    if (/username|already|exist/i.test(m)) return '该账号已被注册';
    if (/password|unauthorized|login/i.test(m)) return '账号或密码错误';
    if (/Failed to fetch|NetworkError/i.test(m)) return '网络错误，请检查网络连接';
    return prefix + '：' + m;
  },

  handleLogout() {
    Bmob.logout();
    Store.logout();
    DesktopPet.hide();
    document.getElementById('app-page').classList.remove('active');
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');

    // 清空表单
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
