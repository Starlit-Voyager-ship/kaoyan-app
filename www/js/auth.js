/* ========================================
   认证系统 - 登录/注册/登出
   ======================================== */

const Auth = {
  MAX_USERS: 5,

  init() {
    this.bindEvents();
    // 检查是否已登录
    const user = Store.getCurrentUser();
    if (user) {
      this.enterApp(user);
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

  enterApp(username) {
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

    const user = await Store.getUser(username);
    if (!user) {
      errorEl.textContent = '账号不存在';
      return;
    }
    if (user.password !== Utils.simpleHash(password)) {
      errorEl.textContent = '密码错误';
      return;
    }

    errorEl.textContent = '';
    this.enterApp(username);
    Utils.toast(`欢迎回来，${username}！`);
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

    // 检查人数限制
    const users = await Store.getUsers();
    if (users.length >= this.MAX_USERS) {
      errorEl.textContent = `注册人数已达上限(${this.MAX_USERS}人)，无法继续注册`;
      return;
    }

    // 检查重名
    if (users.find(u => u.username === username)) {
      errorEl.textContent = '该账号已被注册';
      return;
    }

    // 创建用户
    const newUser = {
      username,
      password: Utils.simpleHash(password),
      inviteCode: Utils.inviteCode(),
      createdAt: new Date().toISOString()
    };

    await Store.saveUser(newUser);

    // 初始化宠物数据
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

    errorEl.textContent = '';
    this.enterApp(username);
    Utils.toast(`注册成功！欢迎 ${username}`);
  },

  handleLogout() {
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
