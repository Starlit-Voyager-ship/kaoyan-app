/* ========================================
   好友双向叫醒系统（后端推送 + 原生强提醒版）
   ----------------------------------------------------
   架构：
     · 绑定 / 叫醒 走 WebSocket 后端（跨设备实时）
     · 收到叫醒 → 调用 Capacitor 原生插件 'WakeAlarm' 强提醒
       （AlarmManager + 高优先级通知 + 全屏提醒 + 覆盖勿扰权限）
     · 非原生环境降级为普通 Web 通知（会被免打扰拦截）
   ======================================== */

/* ---------- 原生强提醒封装 ---------- */
const WakeNative = {
  available() {
    return !!(window.Capacitor && Capacitor.isNativePlatform() &&
              Capacitor.Plugins && Capacitor.Plugins.WakeAlarm);
  },
  async trigger(opts = {}) {
    const payload = {
      message: opts.message || '该起床学习啦！',
      sound: opts.sound !== false,
      fullScreen: opts.fullScreen !== false,
      vibrate: opts.vibrate !== false
    };
    if (this.available()) {
      try {
        return await Capacitor.Plugins.WakeAlarm.triggerWake(payload);
      } catch (e) {
        console.error('[WakeNative] 插件调用失败，降级 Web', e);
        this.webFallback(payload);
      }
    } else {
      this.webFallback(payload);
    }
  },
  webFallback(payload) {
    const msg = payload.message;
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('⏰ 好友叫醒', { body: msg, requireInteraction: true, tag: 'wake' });
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => {
          if (p === 'granted') new Notification('⏰ 好友叫醒', { body: msg, requireInteraction: true, tag: 'wake' });
          else alert('⏰ 好友叫醒：' + msg);
        });
      } else {
        alert('⏰ 好友叫醒：' + msg);
      }
    } else {
      alert('⏰ 好友叫醒：' + msg);
    }
  }
};

/* ---------- 后端 WebSocket 连接 ---------- */
const WakeNet = {
  ws: null,
  connected: false,
  deviceId: null,
  heartbeat: null,
  handlers: {},

  url() {
    if (window.APP_CONFIG && APP_CONFIG.wakeServer) return APP_CONFIG.wakeServer;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  },

  connect(handlers) {
    this.handlers = handlers || {};
    this.deviceId = localStorage.getItem('wake_device_id') || '';
    try {
      this.ws = new WebSocket(this.url());
      this.ws.onopen = () => {
        this.connected = true;
        this.send({ type: 'hello', deviceId: this.deviceId, user: this.handlers.user ? this.handlers.user() : null });
      };
      this.ws.onmessage = (e) => {
        let msg; try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'welcome' && msg.deviceId) {
          this.deviceId = msg.deviceId;
          localStorage.setItem('wake_device_id', msg.deviceId);
        }
        if (this.handlers.onMessage) this.handlers.onMessage(msg);
      };
      this.ws.onclose = () => { this.connected = false; if (this.handlers.onClose) this.handlers.onClose(); };
      this.ws.onerror = () => { this.connected = false; };
      this.heartbeat = setInterval(() => { if (this.connected) this.send({ type: 'ping' }); }, 25000);
    } catch (e) {
      this.connected = false;
      if (this.handlers.onClose) this.handlers.onClose();
    }
  },

  send(obj) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj));
  },

  disconnect() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.ws) this.ws.close();
  }
};

/* ---------- 主模块（UI + 业务逻辑） ---------- */
const FriendWake = {
  longPressTimer: null,
  pressStartTime: 0,
  PRESS_DURATION: 3000,
  bound: false,
  peerUser: null,

  init() {
    this.bindEvents();
    this.connectNet();
    this.loadBinding();
  },

  user() { return Store.getCurrentUser(); },

  connectNet() {
    WakeNet.connect({
      user: () => this.user(),
      onMessage: (msg) => this.handleNet(msg),
      onClose: () => this.updateNetStatus()
    });
    this.updateNetStatus();
  },

  updateNetStatus() {
    const el = document.getElementById('net-status');
    if (!el) return;
    el.innerHTML = WakeNet.connected
      ? '<span style="color:var(--success)">● 已连接叫醒服务</span>'
      : '<span style="color:var(--warning)">○ 未连接（叫醒仅本地演示）</span>';
  },

  handleNet(msg) {
    switch (msg.type) {
      case 'welcome':
        this.updateNetStatus();
        break;
      case 'codeCreated':
        document.getElementById('my-invite-code').textContent = msg.code;
        Utils.toast('邀请码已生成：' + msg.code);
        break;
      case 'bindResult':
        if (msg.ok) {
          this.bound = true;
          this.peerUser = msg.peerUser;
          this.showControl(msg.peerUser || '好友');
          Utils.toast('✅ 绑定成功！');
        } else {
          document.getElementById('bind-info').innerHTML =
            `<span style="color:var(--danger)">${msg.reason || '绑定失败'}</span>`;
        }
        break;
      case 'wake':
        // 收到对方叫醒 → 触发原生强提醒（绕过免打扰）
        WakeNative.trigger({ message: msg.message || '该起床学习啦！' });
        Utils.toast('⏰ 收到好友叫醒！');
        break;
      case 'wakeResult':
        if (!msg.ok) Utils.toast('⚠️ ' + (msg.reason || '叫醒发送失败'));
        else Utils.toast('📢 叫醒已发送');
        break;
      case 'unbindResult':
        this.bound = false;
        this.peerUser = null;
        this.showStatus();
        Utils.toast('已解绑');
        break;
    }
  },

  bindEvents() {
    document.getElementById('create-code-btn').addEventListener('click', () => this.doCreateCode());
    document.getElementById('copy-code-btn').addEventListener('click', () => {
      const code = document.getElementById('my-invite-code').textContent;
      if (code && code !== '--') Utils.copy(code);
    });
    document.getElementById('bind-btn').addEventListener('click', () => this.doBind());
    document.getElementById('unbind-btn').addEventListener('click', () => this.doUnbind());

    const wakeBtn = document.getElementById('wake-btn');
    wakeBtn.addEventListener('mousedown', (e) => this.onPressStart(e));
    wakeBtn.addEventListener('mouseup', () => this.onPressEnd());
    wakeBtn.addEventListener('mouseleave', () => this.onPressEnd());
    wakeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.onPressStart(e); }, { passive: false });
    wakeBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.onPressEnd(); });
    wakeBtn.addEventListener('touchcancel', () => this.onPressEnd());
  },

  loadBinding() {
    const nativeEl = document.getElementById('native-status');
    if (nativeEl) {
      nativeEl.innerHTML = WakeNative.available()
        ? '<span style="color:var(--success)">✓ 原生强提醒可用（可绕过免打扰）</span>'
        : '<span style="color:var(--warning)">⚠ 网页模式：叫醒会被免打扰拦截（装 APK 后可用原生）</span>';
    }
    this.showStatus();
  },

  doCreateCode() {
    if (!WakeNet.connected) { Utils.toast('未连接叫醒服务'); return; }
    WakeNet.send({ type: 'createCode' });
  },

  async doBind() {
    const inputCode = document.getElementById('bind-code-input').value.trim().toUpperCase();
    const infoEl = document.getElementById('bind-info');
    if (!inputCode || inputCode.length !== 6) {
      infoEl.innerHTML = '<span style="color:var(--danger)">请输入6位邀请码</span>'; return;
    }
    if (!WakeNet.connected) {
      infoEl.innerHTML = '<span style="color:var(--danger)">未连接叫醒服务，无法绑定</span>'; return;
    }
    WakeNet.send({ type: 'bind', code: inputCode });
  },

  doUnbind() {
    Utils.showModal('解除绑定', '确定解除好友叫醒绑定关系吗？', `
      <button class="btn-danger" id="confirm-unbind">确认解绑</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);
    document.getElementById('confirm-unbind').onclick = () => {
      WakeNet.send({ type: 'unbind' });
      Utils.hideModal();
    };
  },

  onPressStart(e) {
    this.pressStartTime = Date.now();
    const btn = document.getElementById('wake-btn');
    btn.classList.add('pressing');
    this.longPressTimer = setInterval(() => {
      const elapsed = Date.now() - this.pressStartTime;
      const progress = Math.min(100, (elapsed / this.PRESS_DURATION) * 100);
      btn.style.background = `rgba(239, 68, 68, ${0.1 + progress * 0.009})`;
      if (elapsed >= this.PRESS_DURATION) {
        this.triggerWake();
        this.onPressEnd();
      }
    }, 50);
  },

  onPressEnd() {
    const btn = document.getElementById('wake-btn');
    btn.classList.remove('pressing');
    btn.style.background = '';
    if (this.longPressTimer) { clearInterval(this.longPressTimer); this.longPressTimer = null; }
    const elapsed = Date.now() - this.pressStartTime;
    if (elapsed > 500 && elapsed < this.PRESS_DURATION) {
      Utils.toast(`继续长按！还剩 ${Math.ceil((this.PRESS_DURATION - elapsed) / 1000)} 秒`);
    }
  },

  async triggerWake() {
    if (!this.bound) { Utils.toast('未绑定好友'); return; }
    if (!WakeNet.connected) {
      Utils.showModal('⏰ 叫醒（本地演示）', `
        <div style="text-align:center">
          <div style="font-size:3rem;margin-bottom:12px">📢</div>
          <p>未连接后端叫醒服务，当前为本地演示。</p>
          <p style="color:var(--text-secondary);font-size:0.85rem;margin-top:8px">
            安装 APK 并配置后端后，对方会收到<strong>绕过免打扰</strong>的强提醒。
          </p>
        </div>
      `, `<button class="btn-primary" onclick="Utils.hideModal()">知道了</button>`);
      return;
    }
    WakeNet.send({ type: 'wake', message: '该起床学习啦！' });
  },

  showControl(name) {
    document.getElementById('wake-status').style.display = 'none';
    document.getElementById('wake-control').style.display = 'block';
    document.getElementById('bound-partner').textContent = name;
  },

  showStatus() {
    document.getElementById('wake-status').style.display = 'block';
    document.getElementById('wake-control').style.display = 'none';
  }
};
