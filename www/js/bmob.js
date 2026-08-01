/* ========================================
   Bmob 后端封装 - 用户系统 + 云数据同步
   数据隔离：每条记录带 userId + ACL（仅本人可读写）
   ======================================== */

const Bmob = {
  appId: '',
  restKey: '',
  apiUrl: 'https://api2.bmob.cn/1',
  sessionToken: '',
  userObjectId: '',
  username: '',

  // 从 APP_CONFIG 初始化；并尝试恢复本地会话
  init(cfg) {
    cfg = cfg || (window.APP_CONFIG && window.APP_CONFIG.bmob) || {};
    this.appId = cfg.appId || '';
    this.restKey = cfg.restKey || '';
    this.apiUrl = cfg.apiUrl || 'https://api2.bmob.cn/1';
    try {
      const s = JSON.parse(localStorage.getItem('bmob_session') || 'null');
      if (s && s.sessionToken) {
        this.sessionToken = s.sessionToken;
        this.userObjectId = s.objectId;
        this.username = s.username;
      }
    } catch (e) { /* 忽略 */ }
  },

  hasCredentials() { return !!(this.appId && this.restKey); },
  isLoggedIn() { return !!(this.sessionToken && this.userObjectId); },

  _headers(needAuth) {
    const h = {
      'X-Bmob-Application-Id': this.appId,
      'X-Bmob-REST-API-Key': this.restKey,
      'Content-Type': 'application/json'
    };
    if (needAuth && this.sessionToken) h['X-Bmob-Session-Token'] = this.sessionToken;
    return h;
  },

  async request(method, path, body, needAuth) {
    if (needAuth === undefined) needAuth = true;
    const url = this.apiUrl + path;
    const opts = { method, headers: this._headers(needAuth) };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || ('HTTP ' + res.status);
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  },

  /* ---------- 用户系统 ---------- */
  async register(username, password) {
    const data = await this.request('POST', '/users', { username, password }, false);
    this._setSession(data);
    return data;
  },
  async login(username, password) {
    // 官方文档：登录用 POST + JSON body（不是 GET）
    const data = await this.request('POST', '/login', { username, password }, false);
    this._setSession(data);
    return data;
  },
  _setSession(data) {
    this.sessionToken = data.sessionToken;
    this.userObjectId = data.objectId;
    this.username = data.username;
    localStorage.setItem('bmob_session', JSON.stringify({
      sessionToken: data.sessionToken, objectId: data.objectId, username: data.username
    }));
  },
  logout() {
    this.sessionToken = '';
    this.userObjectId = '';
    this.username = '';
    localStorage.removeItem('bmob_session');
  },

  /* ---------- 数据（统一类 AppData） ---------- */
  _acl() {
    const acl = {};
    if (this.userObjectId) acl[this.userObjectId] = { read: true, write: true };
    acl['*'] = { read: false, write: false }; // 默认禁止其他人访问 → 各账号数据隔离
    return acl;
  },

  // 保存一条记录（按 userId+module+itemId 去重，存在则更新）
  async saveAppData(module, item) {
    if (!this.hasCredentials()) return null;
    const where = { userId: this.username, module, itemId: item.id };
    let existing = null;
    try {
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      existing = (q.results && q.results[0]) || null;
    } catch (e) { console.warn('[Bmob] 查询失败', e); }
    const payload = {
      userId: this.username,
      module,
      itemId: item.id,
      item,
      ACL: this._acl()
    };
    if (existing) {
      return this.request('PUT', '/classes/AppData/' + existing.objectId, payload);
    }
    return this.request('POST', '/classes/AppData', payload);
  },

  // 取某模块全部记录（返回 item 数组）
  async getAppData(module) {
    if (!this.hasCredentials()) return [];
    const where = { userId: this.username, module };
    const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
    return (q.results || []).map(r => r.item);
  },

  async deleteAppData(module, itemId) {
    if (!this.hasCredentials()) return;
    const where = { userId: this.username, module, itemId };
    try {
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      const existing = (q.results && q.results[0]) || null;
      if (existing) await this.request('DELETE', '/classes/AppData/' + existing.objectId);
    } catch (e) { console.warn('[Bmob] 删除失败', e); }
  },

  async clearAppData(module) {
    if (!this.hasCredentials()) return;
    try {
      const where = { userId: this.username, module };
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      const rs = q.results || [];
      for (const r of rs) {
        try { await this.request('DELETE', '/classes/AppData/' + r.objectId); } catch (e) {}
      }
    } catch (e) { console.warn('[Bmob] 清空失败', e); }
  }
};
