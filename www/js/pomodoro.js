/* ========================================
   番茄专注计时模块
   ======================================== */

const Pomodoro = {
  timer: null,
  remaining: 25 * 60,    // 秒
  total: 25 * 60,
  isRunning: false,
  isBreak: false,
  sessionsCompleted: 0,

  init() {
    this.bindEvents();
    this.loadSettings();
    this.updateDisplay();
    this.loadTodayStats();
  },

  bindEvents() {
    document.getElementById('timer-start').addEventListener('click', () => this.start());
    document.getElementById('timer-pause').addEventListener('click', () => this.pause());
    document.getElementById('timer-reset').addEventListener('click', () => this.reset());

    document.getElementById('focus-duration').addEventListener('change', (e) => {
      if (!this.isRunning) {
        this.total = parseInt(e.target.value) * 60;
        this.remaining = this.total;
        this.updateDisplay();
      }
    });
  },

  loadSettings() {
    const user = Store.getCurrentUser();
    if (!user) return;
    const settings = Store.getSettings(user) || {};
    if (settings.focusDuration) {
      document.getElementById('focus-duration').value = settings.focusDuration;
      this.total = settings.focusDuration * 60;
      this.remaining = this.total;
    }
    if (settings.breakDuration) {
      document.getElementById('break-duration').value = settings.breakDuration;
    }
  },

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    document.getElementById('timer-start').style.display = 'none';
    document.getElementById('timer-pause').style.display = 'inline-block';
    document.getElementById('timer-status').textContent = this.isBreak ? '休息中...' : '专注中...';

    const startTime = Date.now();
    this.timer = setInterval(() => {
      this.remaining--;
      this.updateDisplay();

      if (this.remaining <= 0) {
        this.complete();
      }
    }, 1000);
  },

  pause() {
    this.isRunning = false;
    clearInterval(this.timer);
    document.getElementById('timer-start').style.display = 'inline-block';
    document.getElementById('timer-pause').style.display = 'none';
    document.getElementById('timer-status').textContent = '已暂停';
  },

  reset() {
    this.pause();
    this.isBreak = false;
    const focusMin = parseInt(document.getElementById('focus-duration').value) || 25;
    this.total = focusMin * 60;
    this.remaining = this.total;
    this.updateDisplay();
    document.getElementById('timer-status').textContent = '准备开始';

    // 保存设置
    const user = Store.getCurrentUser();
    const settings = Store.getSettings(user);
    settings.focusDuration = focusMin;
    settings.breakDuration = parseInt(document.getElementById('break-duration').value) || 5;
    Store.saveSettings(user, settings);
  },

  async complete() {
    clearInterval(this.timer);
    this.isRunning = false;

    if (!this.isBreak) {
      // 完成一个专注时段
      const duration = parseInt(document.getElementById('focus-duration').value) || 25;
      this.sessionsCompleted++;

      // 记录到数据库
      await Store.put('pomodoro_records', {
        id: Utils.uid(),
        username: Store.getCurrentUser(),
        date: Utils.today(),
        duration: duration,
        completed: true,
        timestamp: new Date().toISOString()
      });

      // 加金币：每分钟1金币
      const user = Store.getCurrentUser();
      await Store.addCoins(user, duration);

      // 更新统计
      this.loadTodayStats();
      app.updateHomeStats();

      // 播放提示音效果（用toast代替）
      Utils.toast(`🎉 专注完成！+${duration}分钟，+${duration}金币`);

      // 切换到休息
      this.isBreak = true;
      const breakMin = parseInt(document.getElementById('break-duration').value) || 5;
      this.total = breakMin * 60;
      this.remaining = this.total;
      this.updateDisplay();
      document.getElementById('timer-status').textContent = '休息时间！';
      document.getElementById('timer-start').style.display = 'inline-block';
      document.getElementById('timer-pause').style.display = 'none';
    } else {
      // 休息结束
      this.isBreak = false;
      const focusMin = parseInt(document.getElementById('focus-duration').value) || 25;
      this.total = focusMin * 60;
      this.remaining = this.total;
      this.updateDisplay();
      document.getElementById('timer-status').textContent = '休息结束，准备继续！';
      document.getElementById('timer-start').style.display = 'inline-block';
      Utils.toast('☕ 休息结束，继续加油！');
    }
  },

  updateDisplay() {
    document.getElementById('timer-time').textContent = Utils.formatTime(this.remaining);

    // 圆环进度
    const circle = document.getElementById('timer-progress');
    const circumference = 565.48; // 2 * PI * 90
    const progress = (this.total - this.remaining) / this.total;
    circle.style.strokeDashoffset = circumference * (1 - progress);

    // 页面标题显示时间
    document.title = `${Utils.formatTime(this.remaining)} - 考研学习助手`;
  },

  async loadTodayStats() {
    const user = Store.getCurrentUser();

    const todaySessions = await Store.getTodaySessions(user);
    const todayMinutes = await Store.getTodayFocusMinutes(user);
    const totalMinutes = await Store.getTotalFocusMinutes(user);

    document.getElementById('today-sessions').textContent = todaySessions;
    document.getElementById('today-total-minutes').textContent = todayMinutes;
    document.getElementById('total-all-minutes').textContent = totalMinutes;
  }
};
