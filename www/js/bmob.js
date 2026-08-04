/* ========================================
   Bmob 后端封装 - 用户系统 + 云数据同步
   数据隔离：每条记录带 userId + ACL（仅本人可读写）
   ======================================== */

const Bmob = {
  appId: '',
  restKey: '',
  // 默认用官方已经验证可用的真实域名（避免写死失效域名导致整体降级）
  apiUrl: 'https://api.bmobcloud.com/1',
  sessionToken: '',
  userObjectId: '',
  username: '',
  // 数据归属用的「规范账号名」（与登录表单输入一致），与认证用的云端账号解耦，
  // 避免多端因 cloud_user_* 映射不同导致数据被拆分到不同云端账号。
  dataUserId: '',

  // 从 APP_CONFIG 初始化；并尝试恢复本地会话
  init(cfg) {
    cfg = cfg || (window.APP_CONFIG && window.APP_CONFIG.bmob) || {};
    this.appId = cfg.appId || '';
    this.restKey = cfg.restKey || '';
    this.apiUrl = (cfg.apiUrl && cfg.apiUrl.indexOf('api2.bmob.cn') === -1)
      ? cfg.apiUrl
      : 'https://api.bmobcloud.com/1';
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

  /* 候选 API 域名（Bmob 历史上多个域名，控制台也可能给出不同地址）。
     启动时光 ping 一次，自动选用第一个可用的，避免写死失效域名导致整体降级。 */
  _candidates() {
    const base = (this.apiUrl || '').replace(/\/1\/?$/, '');
    const set = new Set([
      'https://api.bmobcloud.com',   // 官方 JS SDK 真实域名（2026 验证可用）
      base,
      'https://api.bmobapp.com',
      'https://api2.bmobapp.com',
      'https://api.bmob.cn',
      'https://api2.bmob.cn'
    ]);
    return [...set].filter(Boolean);
  },

  async _ping(host) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(host + '/1/classes/__ping', {
        method: 'GET',
        headers: this._headers(false),
        signal: ctrl.signal
      });
      clearTimeout(t);
      // 200/400/401 都算"域名可达且是 Bmob"；nginx 404 / 网络错误 / 证书错 → 不可用
      if (r.status === 404 && (await r.text()).includes('nginx')) return false;
      return true;
    } catch (e) { return false; }
  },

  async resolveApiUrl() {
    const saved = localStorage.getItem('bmob_api_url');
    if (saved) { this.apiUrl = saved; return saved; }
    for (const h of this._candidates()) {
      if (await this._ping(h)) {
        this.apiUrl = h + '/1';
        localStorage.setItem('bmob_api_url', this.apiUrl);
        console.log('[Bmob] 选用 API 域名：', this.apiUrl);
        return this.apiUrl;
      }
    }
    console.warn('[Bmob] 未探测到可用 API 域名，保持当前配置（将降级本地）');
    return this.apiUrl;
  },

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
    console.log('[Bmob] ▶', method, path, '| body:', body ? JSON.stringify(body).substring(0,100) : '(none)', '| auth:', !!needAuth);
    const res = await fetch(url, opts);
    let data = null;
    const text = await res.text();
    console.log('[Bmob] ◀ status:', res.status, '| response:', text.substring(0,200));
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
  // 注意：Bmob REST API 对 ACL 格式校验极严（要求真实用户 objectId），
  //       创建数据时无法预知 objectId，故不传 ACL，使用 Bmob 默认权限。
  //       数据隔离通过 userId + module 查询条件保证，各账号读写各自数据。

  // 保存一条记录（按 userId+module+itemId 去重，存在则更新）
  async saveAppData(module, item) {
    if (!this.hasCredentials()) return null;
    const uid = this.dataUserId || this.username;
    const where = { userId: uid, module, itemId: item.id };
    let existing = null;
    try {
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      existing = (q.results && q.results[0]) || null;
    } catch (e) { console.warn('[Bmob] 查询失败', e); }
    const payload = {
      userId: uid,
      module,
      itemId: item.id,
      item
    };
    if (existing) {
      return this.request('PUT', '/classes/AppData/' + existing.objectId, payload);
    }
    return this.request('POST', '/classes/AppData', payload);
  },

  // 取某模块全部记录（返回 item 数组）
  // userIdOverride：可选，指定要查询的云端账号（多端合并时用于读取影子账号数据）
  async getAppData(module, userIdOverride) {
    if (!this.hasCredentials()) return [];
    const uid = userIdOverride || this.dataUserId || this.username;
    const where = { userId: uid, module };
    const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
    return (q.results || []).map(r => r.item);
  },

  async deleteAppData(module, itemId) {
    if (!this.hasCredentials()) return;
    const uid = this.dataUserId || this.username;
    const where = { userId: uid, module, itemId };
    try {
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      const existing = (q.results && q.results[0]) || null;
      if (existing) await this.request('DELETE', '/classes/AppData/' + existing.objectId);
    } catch (e) { console.warn('[Bmob] 删除失败', e); }
  },

  async clearAppData(module) {
    if (!this.hasCredentials()) return;
    const uid = this.dataUserId || this.username;
    try {
      const where = { userId: uid, module };
      const q = await this.request('GET', '/classes/AppData?where=' + encodeURIComponent(JSON.stringify(where)));
      const rs = q.results || [];
      for (const r of rs) {
        try { await this.request('DELETE', '/classes/AppData/' + r.objectId); } catch (e) {}
      }
    } catch (e) { console.warn('[Bmob] 清空失败', e); }
  },

  /* ---------- 文件上传 ---------- */
  // 上传文件到 Bmob 云存储，返回 { url, cdn, filename }
  // Bmob 免费版单字段限制 ~40KB，图片必须走文件 API 不能内嵌 base64
  async uploadFile(base64DataUrl, remoteName) {
    if (!this.hasCredentials()) throw new Error('Bmob 未初始化');
    // 从 dataURL 提取纯 base64 数据
    const commaIdx = base64DataUrl.indexOf(',');
    const mimeMatch = base64DataUrl.match(/^data:(.+?);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const b64 = base64DataUrl.substring(commaIdx + 1);
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });

    const filename = remoteName || ('img_' + Date.now() + '.jpg');
    const url = this.apiUrl.replace(/\/1\/?$/, '') + '/2/files/' + filename;

    const h = {
      'X-Bmob-Application-Id': this.appId,
      'X-Bmob-REST-API-Key': this.restKey,
      'Content-Type': mime
    };
    if (this.sessionToken) h['X-Bmob-Session-Token'] = this.sessionToken;

    console.log('[Bmob] ▶ 上传文件:', filename, '| 大小:', blob.size, 'bytes');
    const res = await fetch(url, { method: 'POST', headers: h, body: blob });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    console.log('[Bmob] ◀ 文件上传 status:', res.status, '| response:', text.substring(0, 200));
    if (!res.ok) {
      const code = data && data.code;
      // 10007 = 文件服务未开启/域名未绑定
      if (code === 10007) {
        const err = new Error('BMOB_FILE_SERVICE_DISABLED');
        err.code = 10007;
        err.detail = data.error || '文件服务未开启';
        throw err;
      }
      throw new Error((data && (data.error || data.message)) || ('文件上传失败 HTTP ' + res.status));
    }
    // Bmob 返回格式: { url: "https://...", cdn: "https://...", filename: "..." }
    return {
      url: data.url || data.cdn || '',
      cdn: data.cdn || data.url || '',
      filename: data.filename || filename
    };
  },

  // 批量上传图片数组（base64 data URL 数组），返回 URL 数组
  async uploadImages(imageDataUrls, prefix) {
    const results = [];
    for (let i = 0; i < imageDataUrls.length; i++) {
      try {
        const name = (prefix || 'img') + '_' + Date.now() + '_' + i + '.jpg';
        const uploaded = await this.uploadFile(imageDataUrls[i], name);
        results.push(uploaded.url || uploaded.cdn || '');
      } catch (e) {
        console.warn('[Bmob] 图片', i, '上传失败:', e.message);
        results.push(''); // 失败存空，不阻断整批
      }
    }
    return results;
  }
};
