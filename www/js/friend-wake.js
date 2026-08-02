/* ========================================
   好友双向叫醒系统（本地轮询版 · 支持 Bmob 云端升级）
   ----------------------------------------------------
   设计要点：
     · 不依赖任何 WebSocket 后端，纯前端即可用（生成邀请码 / 绑定 / 叫醒）
     · 数据存放优先级：Bmob 云端（多端互通） → 本地 IndexedDB（降级）
     · 客户端每 15 秒轮询一次"是否有新叫醒"，延迟可控在半分钟内
     · 收到叫醒 → 调用 Capacitor 原生插件 'WakeAlarm' 强提醒（绕过免打扰）
       非原生环境降级为 Web 通知 / alert
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

/* ---------- 叫醒数据访问层（Bmob 云端优先 + 本地兜底） ---------- */
const WakeStore = {
  // 云端是否可用（Bmob 已登录且凭证存在）
  cloudReady() {
    return !!(window.Bmob && Bmob.hasCredentials() && Bmob.isLoggedIn());
  },

  // 写入一条记录（绑定关系 / 叫醒消息）到指定 Bmob 类
  async save(clazz, obj) {
    if (this.cloudReady()) {
      try { return await Bmob.request('POST', '/classes/' + clazz, obj, false); }
      catch (e) { console.warn('[WakeStore] 云端写入失败，回落本地', e.message); }
    }
    // 本地兜底：存 IndexedDB
    if (window.Store && Store.db) {
      return new Promise((resolve) => {
        try {
          const tx = Store.db.transaction('cache', 'readwrite');
          const key = `wake::${clazz}::${obj.code || obj.fromUser || obj.id || Utils.uid()}`;
          tx.objectStore('cache').put({ cid: key, data: obj });
          tx.oncomplete = () => resolve(obj);
          tx.onerror = () => resolve(obj);
        } catch { resolve(obj); }
      });
    }
    return obj;
  },

  // 查询：返回 object 数组
  async query(clazz, where) {
    if (this.cloudReady()) {
      try {
        const q = await Bmob.request('GET', '/classes/' + clazz + '?where=' + encodeURIComponent(JSON.stringify(where)), undefined, false);
        return q.results || [];
      } catch (e) { console.warn('[WakeStore] 云端查询失败，回落本地', e.message); }
    }
    // 本地兜底
    if (window.Store && Store.db) {
      return new Promise((resolve) => {
        try {
          const tx = Store.db.transaction('cache', 'readonly');
          const req = tx.objectStore('cache').openCursor();
          const out = [];
          req.onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) {
              if (cur.key.startsWith(`wake::${clazz}::`)) {
                const d = cur.value.data;
                // 简单 where 匹配（仅支持相等比较）
                const ok = Object.entries(where).every(([k, v]) => d[k] === v);
                if (ok) out.push(d);
              }
              cur.continue();
            } else resolve(out);
          };
          req.onerror = () => resolve([]);
        } catch { resolve([]); }
      });
    }
    return [];
  },

  // 删除匹配记录
  async remove(clazz, where) {
    if (this.cloudReady()) {
      try {
        const list = await this.query(clazz, where);
        for (const r of list) {
          if (r.objectId) await Bmob.request('DELETE', '/classes/' + clazz + '/' + r.objectId, undefined, false);
        }
        return;
      } catch (e) { console.warn('[WakeStore] 云端删除失败', e.message); }
    }
    if (window.Store && Store.db) {
      return new Promise((resolve) => {
        try {
          const tx = Store.db.transaction('cache', 'readwrite');
          const req = tx.objectStore('cache').openCursor();
          req.onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) {
              if (cur.key.startsWith(`wake::${clazz}::`)) {
                const d = cur.value.data;
                const ok = Object.entries(where).every(([k, v]) => d[k] === v);
                if (ok) cur.delete();
              }
              cur.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        } catch { resolve(); }
      });
    }
  }
};

/* ---------- 主模块（UI + 业务逻辑） ---------- */
const FriendWake = {
  longPressTimer: null,
  pressStartTime: 0,
  PRESS_DURATION: 3000,
  bound: false,
  peerUser: null,
  peerCode: null,        // 对方账号（用于云端/本地匹配）
  myCode: null,          // 我的绑定码
  pollTimer: null,
  lastWakeTs: 0,

  init() {
    this.bindEvents();
    this.loadBinding();
    this.startPolling();
  },

  user() { return Store.getCurrentUser(); },

  /* ---------- 状态显示（纯云端） ---------- */
  updateNetStatus() {
    const el = document.getElementById('net-status');
    if (!el) return;
    if (WakeStore.cloudReady()) {
      el.innerHTML = '<span style="color:var(--success)">● 云端同步已开启</span>';
    } else {
      el.innerHTML = '<span style="color:var(--danger)">⚠ 未连接云端（请重新登录）</span>' +
        ' <button id="btn-relogin-wake" style="font-size:0.75rem;padding:2px 8px;margin-left:4px;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:4px;cursor:pointer;">退出重登</button>';
      setTimeout(() => {
        const btn = document.getElementById('btn-relogin-wake');
        if (btn) btn.onclick = () => { Auth.handleLogout(); };
      }, 100);
    }
  },

  loadBinding() {
    const nativeEl = document.getElementById('native-status');
    if (nativeEl) {
      nativeEl.innerHTML = WakeNative.available()
        ? '<span style="color:var(--success)">✓ 原生强提醒可用（可绕过免打扰）</span>'
        : '<span style="color:var(--warning)">⚠ 网页模式：叫醒会被免打扰拦截（装 APK 后可用原生）</span>';
    }
    // 恢复本地已保存的绑定关系
    try {
      const saved = JSON.parse(localStorage.getItem('wake_binding') || 'null');
      if (saved && saved.peerUser) {
        this.bound = true;
        this.peerUser = saved.peerUser;
        this.myCode = saved.myCode;
        this.peerCode = saved.peerCode;
        this.showControl(saved.peerUser);
      } else {
        this.showStatus();
      }
    } catch { this.showStatus(); }
    this.updateNetStatus();
  },

  saveBinding() {
    localStorage.setItem('wake_binding', JSON.stringify({
      peerUser: this.peerUser, myCode: this.myCode, peerCode: this.peerCode
    }));
  },
  clearBindingStore() {
    localStorage.removeItem('wake_binding');
  },

  /* ---------- 绑定流程 ---------- */
  bindEvents() {
    const createBtn = document.getElementById('create-code-btn');
    const copyBtn = document.getElementById('copy-code-btn');
    const bindBtn = document.getElementById('bind-btn');
    const unbindBtn = document.getElementById('unbind-btn');
    if (createBtn) createBtn.addEventListener('click', () => this.doCreateCode());
    if (copyBtn) copyBtn.addEventListener('click', () => {
      const code = document.getElementById('my-invite-code').textContent;
      if (code && code !== '--') Utils.copy(code);
    });
    if (bindBtn) bindBtn.addEventListener('click', () => this.doBind());
    if (unbindBtn) unbindBtn.addEventListener('click', () => this.doUnbind());

    const wakeBtn = document.getElementById('wake-btn');
    if (wakeBtn) {
      wakeBtn.addEventListener('mousedown', (e) => this.onPressStart(e));
      wakeBtn.addEventListener('mouseup', () => this.onPressEnd());
      wakeBtn.addEventListener('mouseleave', () => this.onPressEnd());
      wakeBtn.addEventListener('touchstart', (e) => { e.preventDefault(); this.onPressStart(e); }, { passive: false });
      wakeBtn.addEventListener('touchend', (e) => { e.preventDefault(); this.onPressEnd(); });
      wakeBtn.addEventListener('touchcancel', () => this.onPressEnd());
    }
  },

  async doCreateCode() {
    const me = this.user();
    if (!me) { Utils.toast('⚠️ 请先登录后再生成邀请码'); return; }
    try {
      const code = Utils.inviteCode() || (Math.random().toString(36).slice(2, 8).toUpperCase());
      this.myCode = code;
      // 清掉旧码，写新码（带 10 分钟有效期）
      await WakeStore.remove('WakeBind', { fromUser: me });
      await WakeStore.save('WakeBind', {
        fromUser: me, toUser: '', code,
        type: 'invite', expireAt: Date.now() + 10 * 60 * 1000
      });
      document.getElementById('my-invite-code').textContent = code;
      Utils.toast('✅ 邀请码已生成：' + code + '（10分钟内有效）');
      this.saveBinding();
    } catch (e) {
      console.error('[FriendWake] 生成邀请码失败:', e);
      // 兜底：即使存储失败也显示一个码（纯展示用，对方绑定时查不到会提示无效）
      const fallback = 'LOCAL' + Math.random().toString(36).slice(2, 8).toUpperCase();
      document.getElementById('my-invite-code').textContent = fallback;
      Utils.toast('⚠️ 本地存储异常，邀请码可能无法同步');
    }
  },

  async doBind() {
    const me = this.user();
    const infoEl = document.getElementById('bind-info');
    const inputCode = (document.getElementById('bind-code-input').value || '').trim().toUpperCase();
    if (!me) { infoEl.innerHTML = '<span style="color:var(--danger)">请先登录</span>'; return; }
    if (!inputCode || inputCode.length !== 6) {
      infoEl.innerHTML = '<span style="color:var(--danger)">请输入6位邀请码</span>'; return;
    }

    // 查找对方发出的邀请码
    let matches = [];
    try {
      matches = await WakeStore.query('WakeBind', { code: inputCode, type: 'invite' });
    } catch (e) { /* 回落 */ }

    const valid = (matches || []).find(m => m.fromUser && m.fromUser !== me && (!m.expireAt || m.expireAt > Date.now()));
    if (!valid) {
      infoEl.innerHTML = '<span style="color:var(--danger)">邀请码无效或已过期</span>';
      return;
    }

    // 双向绑定：更新对方邀请码记录指向我，并写一条 my→peer 绑定关系
    if (WakeStore.cloudReady() && valid.objectId) {
      try { await Bmob.request('PUT', '/classes/WakeBind/' + valid.objectId, { toUser: me }, false); } catch (e) {}
    }
    await WakeStore.save('WakeBind', {
      fromUser: me, toUser: valid.fromUser, code: inputCode,
      type: 'bond', expireAt: 0
    });

    this.bound = true;
    this.peerUser = valid.fromUser;
    this.peerCode = valid.fromUser;
    this.myCode = inputCode;
    this.saveBinding();
    this.showControl(valid.fromUser);
    infoEl.innerHTML = '<span style="color:var(--success)">✅ 绑定成功！</span>';
    Utils.toast('✅ 绑定成功！');
  },

  doUnbind() {
    Utils.showModal('解除绑定', '确定解除好友叫醒绑定关系吗？', `
      <button class="btn-danger" id="confirm-unbind">确认解绑</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);
    document.getElementById('confirm-unbind').onclick = async () => {
      const me = this.user();
      await WakeStore.remove('WakeBind', { fromUser: me });
      this.bound = false;
      this.peerUser = null;
      this.peerCode = null;
      this.clearBindingStore();
      this.showStatus();
      Utils.hideModal();
      Utils.toast('已解绑');
    };
  },

  /* ---------- 叫醒（长按触发） ---------- */
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
    const me = this.user();
    const msg = { type: 'wake', fromUser: me, toUser: this.peerUser, message: '该起床学习啦！', ts: Date.now() };
    await WakeStore.save('WakeMsg', {
      fromUser: me, toUser: this.peerUser, message: '该起床学习啦！', ts: Date.now()
    });
    Utils.toast('📢 叫醒已发送（对方约半分钟内收到）');
  },

  /* ---------- 轮询：检查是否有人叫醒我 ---------- */
  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), 15000);
    this.poll();
  },

  async poll() {
    const me = this.user();
    if (!me) return;
    try {
      const msgs = await WakeStore.query('WakeMsg', { toUser: me });
      const fresh = (msgs || []).filter(m => m.ts && m.ts > this.lastWakeTs);
      if (fresh.length) {
        // 取最新一条触发
        fresh.sort((a, b) => b.ts - a.ts);
        this.lastWakeTs = fresh[0].ts;
        WakeNative.trigger({ message: fresh[0].message || '该起床学习啦！' });
        Utils.toast('⏰ 收到好友叫醒！');
      }
    } catch (e) { /* 静默 */ }
    this.updateNetStatus();
  },

  /* ---------- 视图切换 ---------- */
  showControl(name) {
    const s = document.getElementById('wake-status');
    const c = document.getElementById('wake-control');
    if (s) s.style.display = 'none';
    if (c) c.style.display = 'block';
    const p = document.getElementById('bound-partner');
    if (p) p.textContent = name;
  },
  showStatus() {
    const s = document.getElementById('wake-status');
    const c = document.getElementById('wake-control');
    if (s) s.style.display = 'block';
    if (c) c.style.display = 'none';
  }
};
