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

/* ---------- 注册本地原生插件（WakeAlarm 无 web 实现，纯桥接到 Android 原生） ---------- */
/* 说明：WakeAlarm 的 Java 代码直接放在 android/app 的 app module 中，
   原生侧会被 @CapacitorPlugin 注解自动注册；但 web 侧不会自动写入
   capacitor.plugins.json，导致 Capacitor.Plugins.WakeAlarm 为 undefined、
   WakeNative.available() 误判为不可用，从而降级为浏览器通知（仅有系统默认震动）。
   这里在原生平台手动注册插件桥，才能调用原生的全屏+响铃+震动强提醒。 */
(function registerWakeAlarmPlugin() {
  try {
    if (window.Capacitor && Capacitor.isNativePlatform() && !Capacitor.Plugins.WakeAlarm) {
      Capacitor.registerPlugin('WakeAlarm');
      console.log('[WakeNative] 已注册 WakeAlarm 原生插件桥');
    }
  } catch (e) {
    console.warn('[WakeNative] 注册失败，将降级 Web 通知', e);
  }
})();

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
      vibrate: opts.vibrate !== false,
      fromUser: opts.fromUser || '',   // 发送方账号（peer）
      toUser: opts.toUser || ''        // 接收方自己（me）
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
  // 注意：脚本加载顺序可能导致首次调用时 Bmob 尚未初始化，
  //       因此内置重试：首次返回 false 时 1s 后再查一次
  _cloudReadyCache: null,
  _cloudReadyTimer: null,

  cloudReady() {
    // 用 typeof 检测（const 声明不一定挂到 window.Bmob）
    const hasBmob = (typeof Bmob !== 'undefined');
    const hasCreds = hasBmob && Bmob.hasCredentials();
    const loggedIn = hasCreds && Bmob.isLoggedIn();
    const result = !!(hasBmob && hasCreds && loggedIn);

    // 缓存结果，避免每次轮询都打日志
    if (result !== this._cloudReadyCache) {
      this._cloudReadyCache = result;
      console.log('[FriendWake] cloudReady:', result,
        '| loggedIn:', loggedIn, '| user:', hasCreds ? (Bmob.username || '-') : '-');
    }

    // 首次检测到 Bmob 不存在 → 1s 后自动重试（应对脚本加载时序问题）
    if (!hasBmob && !this._cloudReadyTimer) {
      this._cloudReadyTimer = setTimeout(() => {
        this._cloudReadyTimer = null;
        this._cloudReadyCache = null; // 清缓存让下次重新打日志
        // 注意：这里 this 指向 WakeStore，必须用 FriendWake.updateNetStatus
        if (window.FriendWake) FriendWake.updateNetStatus();
      }, 1000);
    }
    return result;
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
  lastSendTs: 0,
  lastSendTo: '',
  lastPollTs: 0,
  lastPending: 0,
  _lastUser: null,
  _guardStarted: false,

  init() {
    this.bindEvents();
    this.loadBinding();
    this.startPolling();
  },

  // 取 Bmob 凭证（原生守护服务轮询需要）
  creds() {
    if (typeof Bmob !== 'undefined' && Bmob.appId) {
      return { appId: Bmob.appId, restKey: Bmob.restKey };
    }
    if (window.APP_CONFIG) return { appId: APP_CONFIG.appId, restKey: APP_CONFIG.restKey };
    return { appId: '', restKey: '' };
  },

  // 启动原生前台守护：锁屏/后台也持续轮询云端（真正的后台收叫醒）
  maybeStartGuard() {
    if (!WakeNative.available()) return;
    const me = this.user();
    const ready = WakeStore.cloudReady();
    // 未登录则停止守护
    if (!me || !ready) {
      if (this._guardStarted) {
        try { Capacitor.Plugins.WakeAlarm.stopGuard(); } catch (e) {}
        this._guardStarted = false;
      }
      return;
    }
    if (this._guardStarted) return;
    const c = this.creds();
    if (!c.appId) return;
    try {
      Capacitor.Plugins.WakeAlarm.startGuard({
        appId: c.appId, restKey: c.restKey, username: me, lastTs: this.lastWakeTs
      });
      this._guardStarted = true;
      console.log('[FriendWake] 原生守护已启动（后台收叫醒）');
    } catch (e) { console.warn('[FriendWake] 启动守护失败', e); }
  },

  // 渲染诊断面板，方便一眼看清两边状态
  renderDiag() {
    const el = document.getElementById('wake-diag');
    if (!el) return;
    const me = this.user() || '未登录';
    const peer = this.peerUser || '未绑定';
    const guard = (WakeNative.available() && this._guardStarted) ? '<span style="color:var(--success)">●</span> 运行中（后台也能收）' : (WakeNative.available() ? '<span style="color:var(--text-light)">●</span> 未启动' : '—（网页模式）');
    const send = this.lastSendTs ? (new Date(this.lastSendTs).toLocaleTimeString() + ' 发给 ' + this.lastSendTo) : '尚未发送';
    const poll = this.lastPollTs ? (Math.round((Date.now() - this.lastPollTs) / 1000) + ' 秒前') : '—';
    const pend = this.lastPending > 0 ? ('有 ' + this.lastPending + ' 条未读叫醒') : '无';
    el.innerHTML =
      '<div class="diag-row"><span>我的账号</span><b>' + me + '</b></div>' +
      '<div class="diag-row"><span>绑定对象</span><b>' + peer + '</b></div>' +
      '<div class="diag-row"><span>后台守护</span><b>' + guard + '</b></div>' +
      '<div class="diag-row"><span>上次发送</span><b>' + send + '</b></div>' +
      '<div class="diag-row"><span>上次轮询</span><b>' + poll + '</b></div>' +
      '<div class="diag-row"><span>云端待接收</span><b>' + pend + '</b></div>';
  },

  user() { return Store.getCurrentUser(); },

  /* ---------- 状态显示（纯云端） ---------- */
  updateNetStatus() {
    const el = document.getElementById('net-status');
    if (!el) return;
    const ready = WakeStore.cloudReady();
    if (ready) {
      el.innerHTML = '<span style="color:var(--success)">● 云端同步已开启</span>';
    } else {
      el.innerHTML = '<span style="color:var(--danger)">未连接云端（请重新登录）</span>' +
        ' <button id="btn-relogin-wake" style="font-size:0.75rem;padding:2px 8px;margin-left:4px;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:4px;cursor:pointer;">退出重登</button>';
      setTimeout(() => {
        const btn = document.getElementById('btn-relogin-wake');
        if (btn) btn.onclick = () => { Auth.handleLogout(); };
      }, 100);
    }
    // 同步到底部全局状态栏（如果存在）
    const footerEl = document.getElementById('footer-net-status');
    if (footerEl) {
      footerEl.innerHTML = ready
        ? '<span style="color:var(--success)">● 云端同步已开启</span>'
        : '<span style="color:var(--warning)">○ 本地模式</span>';
    }
    // 原生平台：确保后台守护在跑（锁屏也能收叫醒）
    this.maybeStartGuard();
    this.renderDiag();
  },

  loadBinding() {
    const nativeEl = document.getElementById('native-status');
    if (nativeEl) {
      nativeEl.innerHTML = WakeNative.available()
        ? '<span style="color:var(--success)">原生强提醒可用（可绕过免打扰）</span>'
        : '<span style="color:var(--warning)">网页模式：叫醒会被免打扰拦截（装 APK 后可用原生）</span>';
    }
    // 原生平台：应用打开即申请通知权限（Android 13+ 会弹窗，用户允许即可正常弹出强提醒）
    if (WakeNative.available()) {
      try {
        Capacitor.Plugins.WakeAlarm.requestNotifyPermission();
      } catch (e) { /* 忽略 */ }
    }
    // 原生平台：检测是否已获得"覆盖勿扰"权限，未授权则引导（否则响铃在 DND 下被静音）
    if (WakeNative.available()) {
      try {
        Capacitor.Plugins.WakeAlarm.canOverrideDnd().then(r => {
          if (r && r.granted !== true) {
            const tip = document.getElementById('dnd-tip');
            if (tip) {
              tip.style.display = 'block';
              tip.innerHTML = '未授权"绕过免打扰"：开启勿扰/静音时响铃可能不响。' +
                '<button id="btn-dnd" style="margin-left:8px;font-size:0.75rem;padding:2px 8px;border:1px solid var(--primary);color:var(--primary);background:transparent;border-radius:4px;cursor:pointer;">去授权</button>';
              setTimeout(() => {
                const b = document.getElementById('btn-dnd');
                if (b) b.onclick = () => Capacitor.Plugins.WakeAlarm.requestDndAccess();
              }, 100);
            }
          }
        }).catch(() => {});
      } catch (e) { /* 忽略 */ }
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
    // 启动即尝试从云端同步绑定关系（被邀请方在对方填码后自动互绑）
    this.detectBond(false);
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
    if (!me) { Utils.toast('请先登录后再生成邀请码'); return; }
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
      Utils.toast('邀请码已生成：' + code + '（10分钟内有效）');
      this.saveBinding();
    } catch (e) {
      console.error('[FriendWake] 生成邀请码失败:', e);
      // 兜底：即使存储失败也显示一个码（纯展示用，对方绑定时查不到会提示无效）
      const fallback = 'LOCAL' + Math.random().toString(36).slice(2, 8).toUpperCase();
      document.getElementById('my-invite-code').textContent = fallback;
      Utils.toast('本地存储异常，邀请码可能无法同步');
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

    // 查找对方发出的邀请码（未被使用过）
    let matches = [];
    try {
      matches = await WakeStore.query('WakeBind', { code: inputCode, type: 'invite' });
    } catch (e) { /* 回落 */ }

    const valid = (matches || []).find(m =>
      m.fromUser && m.fromUser !== me &&
      (!m.expireAt || m.expireAt > Date.now()) &&
      !m.consumed); // 已消费（被他人绑定过）的邀请码不可复用
    if (!valid) {
      infoEl.innerHTML = '<span style="color:var(--danger)">邀请码无效、已过期或已被使用</span>';
      return;
    }

    const peer = valid.fromUser;
    // ① 我 → 对方 的绑定记录（允许我主动叫醒对方）
    await WakeStore.save('WakeBind', {
      fromUser: me, toUser: peer, code: inputCode,
      type: 'bond', expireAt: 0
    });
    // ② 对方 → 我 的绑定记录（关键：让对方也能回叫醒我，实现互相叫醒）
    await WakeStore.save('WakeBind', {
      fromUser: peer, toUser: me, code: inputCode,
      type: 'bond', expireAt: 0
    });
    // 标记对方邀请码已消费，避免被第三人重复绑定
    if (WakeStore.cloudReady() && valid.objectId) {
      try { await Bmob.request('PUT', '/classes/WakeBind/' + valid.objectId, { toUser: me, consumed: true }, false); } catch (e) {}
    }

    this.bound = true;
    this.peerUser = peer;
    this.peerCode = peer;
    this.myCode = inputCode;
    this.saveBinding();
    this.showControl(peer);
    infoEl.innerHTML = '<span style="color:var(--success)">绑定成功！现在你们可以互相叫醒</span>';
    Utils.toast('绑定成功！可以互相叫醒');
    this.maybeStartGuard();
    this.renderDiag();
  },

  // 解除一对绑定：删除自己与对方各自的绑定记录（互相解绑）
  async removePairBond(me, peer) {
    await WakeStore.remove('WakeBind', { fromUser: me });
    if (peer) await WakeStore.remove('WakeBind', { fromUser: peer, toUser: me });
  },

  doUnbind() {
    Utils.showModal('解除绑定', '确定解除好友叫醒绑定关系吗？双方将同时解除互相叫醒。', `
      <button class="btn-danger" id="confirm-unbind">确认解绑</button>
      <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
    `);
    document.getElementById('confirm-unbind').onclick = async () => {
      const me = this.user();
      const peer = this.peerUser;
      await this.removePairBond(me, peer);
      this.bound = false;
      this.peerUser = null;
      this.peerCode = null;
      this.clearBindingStore();
      this.showStatus();
      Utils.hideModal();
      Utils.toast('已解绑');
    };
  },

  /* ---------- 自动同步绑定关系（云端为准） ---------- */
  // 我（被邀请方或邀请方）打开应用/轮询时，检测云端是否存在指向我的绑定记录，
  // 若存在则自动进入"已绑定"状态——这是实现"互相叫醒"的关键：
  // 邀请方 A 发出邀请后无需任何操作，B 填码瞬间即写入 A→B 的绑定记录，A 下次轮询自动绑定。
  async detectBond(allowUnbind) {
    const me = this.user();
    if (!me) return false;
    let list = [];
    try { list = await WakeStore.query('WakeBind', { fromUser: me }); }
    catch (e) { return false; }

    const record = (list || []).find(r =>
      (r.type === 'bond' && r.toUser && r.toUser !== me) ||
      (r.type === 'invite' && r.toUser && r.toUser !== me && r.consumed)
    );

    if (record) {
      const peer = record.toUser;
      if (!this.bound || this.peerUser !== peer) {
        this.bound = true;
        this.peerUser = peer;
        this.peerCode = peer;
        this.myCode = record.code || this.myCode;
        this.saveBinding();
        // 确保自己侧存在 bond 记录（幂等，避免对方解绑重绑后丢失）
        WakeStore.save('WakeBind', {
          fromUser: me, toUser: peer, code: record.code || this.myCode,
          type: 'bond', expireAt: 0
        }).catch(() => {});
        this.showControl(peer);
        this.renderDiag();
        Utils.toast('已与 ' + peer + ' 互相绑定，可互相叫醒');
      }
      this.maybeStartGuard();
      return true;
    }

    // 云端已无指向我的绑定记录（对方已解绑）→ 同步解除本地绑定
    if (allowUnbind && this.bound && this.peerUser && WakeStore.cloudReady()) {
      this.bound = false;
      this.peerUser = null;
      this.peerCode = null;
      this.clearBindingStore();
      this.showStatus();
      this.renderDiag();
    }
    return false;
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
    Utils.toast('叫醒已发送（对方约半分钟内收到）');
  },

  /* ---------- 轮询：检查是否有人叫醒我 ---------- */
  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.poll(), 15000);
    this.poll();
  },

  async poll() {
    const me = this.user();
    if (!me) { this._lastUser = null; return; }
    // 账号切换：按账号恢复已读游标，避免跨账号串扰 / 误把别人历史当自己的
    if (me !== this._lastUser) {
      this._lastUser = me;
      const saved = parseInt(localStorage.getItem('wake_lastts_' + me) || '0', 10);
      this.lastWakeTs = isNaN(saved) ? 0 : saved;
    }
    this.lastPollTs = Date.now();
    try {
      const msgs = await WakeStore.query('WakeMsg', { toUser: me });
      const fresh = (msgs || []).filter(m =>
        m.ts && m.ts > this.lastWakeTs &&
        m.fromUser && m.fromUser !== me &&   // 排除脏数据 / 自己发给自己
        m.toUser === me                       // 严格归属
      );
      // 全新账号（游标仍为 0）：推进到当前时刻并跳过历史垃圾，不再误触发
      if (this.lastWakeTs === 0) {
        this.lastWakeTs = Date.now();
        try { localStorage.setItem('wake_lastts_' + me, String(this.lastWakeTs)); } catch (e) {}
        this.lastPending = 0;
        this.updateNetStatus();
        return;
      }
      this.lastPending = fresh.length;
      // 分类：叫醒（wake）与关闭回执（closed）
      const wakes = fresh.filter(m => (m.type || 'wake') === 'wake');
      const closed = fresh.filter(m => m.type === 'closed');
      if (wakes.length) {
        wakes.sort((a, b) => b.ts - a.ts);
        WakeNative.trigger({
          message: wakes[0].message || '该起床学习啦！',
          fromUser: wakes[0].fromUser,   // 发送方
          toUser: me                      // 接收方自己
        });
        Utils.toast('收到好友叫醒！');
      }
      if (closed.length) {
        closed.sort((a, b) => b.ts - a.ts);
        Utils.toast((closed[0].fromUser || '对方') + ' 已关闭闹钟');
      }
      // 推进游标到最新消息（含 closed），避免重复提示
      const maxTs = fresh.reduce((mx, m) => Math.max(mx, m.ts), this.lastWakeTs);
      this.lastWakeTs = maxTs;
      try { localStorage.setItem('wake_lastts_' + me, String(this.lastWakeTs)); } catch (e) {}
      this.lastPending = 0;
    } catch (e) { /* 静默 */ }

    // 绑定关系自愈：未绑定时自动发现（被邀请方自动互绑）；已绑定时检测对方是否已解绑
    try {
      if (!this.bound) {
        await this.detectBond(false);
      } else if (this.peerUser && WakeStore.cloudReady()) {
        await this.detectBond(true);
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
