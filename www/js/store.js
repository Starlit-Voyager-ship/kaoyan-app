/* ========================================
   数据存储层 - Bmob 云同步 + 本地 IndexedDB 缓存
   多端互通：登录后数据写入云端，换设备登录同账号自动拉取
   数据隔离：每条云端记录带 userId + ACL，各账号仅可读写自己的数据
   ======================================== */

const Store = {
  db: null,
  dbName: 'KaoyanHelperDB',
  currentUser: null,
  _coinQueue: Promise.resolve(),
  _cloudFailToastAt: 0,

  async init() {
    // 初始化本地缓存库（始终可用，离线兜底）
    await this._initLocal();
    // 初始化 Bmob（云端同步）
    Bmob.init(window.APP_CONFIG && window.APP_CONFIG.bmob);
    // 自动探测可用 API 域名，写错/失效域名时自动回退（提升云端连通率）
    if (Bmob.hasCredentials()) {
      try { await Bmob.resolveApiUrl(); } catch (e) { console.warn('[Store] API 域名探测失败', e); }
    }
    return;
  },

  _initLocal() {
    return new Promise((resolve) => {
      // 环境兜底：老旧 WebView / 隐私模式 / file:// 直接打开时可能无 IndexedDB。
      // 此时降级为"仅云端"，不阻塞启动；cache 系列方法已对 db=null 安全返回。
      if (typeof indexedDB === 'undefined' || !indexedDB) {
        this.db = null;
        console.warn('[Store] 当前环境不支持 IndexedDB，本地缓存降级为云端优先');
        return resolve();
      }
      try {
        const req = indexedDB.open(this.dbName, 2); // 版本号升级以添加 users 表
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('cache')) {
            db.createObjectStore('cache', { keyPath: 'cid' });
          }
          if (!db.objectStoreNames.contains('users')) {
            db.createObjectStore('users', { keyPath: 'id' });
          }
        };
        req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
        req.onerror = () => { this.db = null; resolve(); }; // 本地库失败不阻塞
      } catch (e) {
        this.db = null;
        console.warn('[Store] IndexedDB 初始化异常，降级为云端优先', e);
        resolve();
      }
    });
  },

  // ---- 本地缓存（离线兜底）----
  async _cachePut(cid, data) {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put({ cid, data });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  },
  async _cacheGet(cid) {
    if (!this.db) return null;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('cache', 'readonly');
        const req = tx.objectStore('cache').get(cid);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  },

  // ---- 云端 + 本地 双写 ----
  async put(storeName, data) {
    const user = this.getCurrentUser();
    const item = Object.assign({}, data, { username: user });
    // 本地缓存
    await this._cachePut(`${user}::${storeName}::${data.id}`, item);
    // 云端同步（带 userId + ACL 隔离）
    if (Bmob.isLoggedIn()) {
      try { await Bmob.saveAppData(storeName, item); }
      catch (e) {
        console.warn('[Store] 云端保存失败（稍后联网重试）', e.message);
        this._notifyCloudFailure();
      }
    }
    return;
  },

  async get(storeName, id) {
    const user = this.getCurrentUser();
    const all = await this.getUserData(storeName, user);
    return all.find(i => i.id === id) || null;
  },

  async getAll(storeName) {
    const user = this.getCurrentUser();
    return this._getUserDataFromCloudOrCache(storeName, user);
  },

  async delete(storeName, id) {
    const user = this.getCurrentUser();
    await this._cachePut(`${user}::${storeName}::${id}`, null);
    if (Bmob.isLoggedIn()) {
      try { await Bmob.deleteAppData(storeName, id); }
      catch (e) {
        console.warn('[Store] 云端删除失败（稍后联网重试）', e.message);
        this._notifyCloudFailure();
      }
    }
  },

  async clear(storeName) {
    const user = this.getCurrentUser();
    if (Bmob.isLoggedIn()) {
      try { await Bmob.clearAppData(storeName); } catch (e) {}
    }
    // 清本地缓存
    if (this.db) {
      return new Promise((resolve) => {
        try {
          const tx = this.db.transaction('cache', 'readwrite');
          const store = tx.objectStore('cache');
          const req = store.openCursor();
          req.onsuccess = (e) => {
            const cur = e.target.result;
            if (cur) {
              if (cur.key.startsWith(`${user}::${storeName}::`)) cur.delete();
              cur.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        } catch { resolve(); }
      });
    }
  },

  // ---- 按用户过滤（云端优先，回落本地缓存）----
  async getUserData(storeName, username) {
    return this._getUserDataFromCloudOrCache(storeName, username);
  },

  async _getUserDataFromCloudOrCache(storeName, username) {
    const canonical = username;
    // 候选账号：规范名 + 当前认证云端名（多端可能因影子账号解析不同而分散）
    const candidates = [...new Set([canonical, Bmob.username].filter(Boolean))];
    let cloudItems = [];
    if (Bmob.isLoggedIn()) {
      for (const uid of candidates) {
        try {
          const items = await Bmob.getAppData(storeName, uid);
          cloudItems = cloudItems.concat(items);
        } catch (e) { /* 某候选账号无数据则忽略，继续下一个 */ }
      }
    }
    // 按 item.id 去重，避免多候选账号重复显示
    const seen = new Set();
    cloudItems = cloudItems.filter(i => i && i.id && !seen.has(i.id) && seen.add(i.id));

    const cloudIds = new Set(cloudItems.map(i => i && i.id));
    let localItems = await this._getUserDataFromCache(storeName, canonical);
    // 兼容历史：本地缓存可能曾以影子账号名（如 123_msb7wtet）为键存储，一并取出回传
    if (Bmob.username && Bmob.username !== canonical) {
      const shadowLocal = await this._getUserDataFromCache(storeName, Bmob.username);
      localItems = localItems.concat(shadowLocal);
    }
    const localOnly = localItems.filter(i => i && i.id && !cloudIds.has(i.id));
    const merged = cloudItems.concat(localOnly);

    // 打通多端：仅存在于本机缓存的数据（如电脑端本地保存的文章/题目）回传到云端，
    // 之后其他设备即可拉取。写入统一用规范账号名，避免再次分散。
    if (Bmob.isLoggedIn() && localOnly.length) {
      for (const it of localOnly) {
        try {
          await Bmob.saveAppData(storeName, Object.assign({}, it, { username: canonical }));
        } catch (e) { console.warn('[Store] 本地数据回传云端失败', e.message); }
      }
    }
    // 同步合并结果到本地缓存
    for (const it of merged) {
      await this._cachePut(`${canonical}::${storeName}::${it.id}`, it);
    }
    return merged;
  },

  async _getUserDataFromCache(storeName, username) {
    if (!this.db) return [];
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('cache', 'readonly');
        const store = tx.objectStore('cache');
        const req = store.openCursor();
        const out = [];
        req.onsuccess = (e) => {
          const cur = e.target.result;
          if (cur) {
            if (cur.key.startsWith(`${username}::${storeName}::`) && cur.value.data) {
              out.push(cur.value.data);
            }
            cur.continue();
          } else resolve(out);
        };
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  },

  // ---- IndexedDB 本地读写辅助（用于用户管理等纯本地数据）----
  _localGetAll(storeName) {
    return new Promise((resolve) => {
      if (!this.db) return resolve([]);
      try {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  },
  _localPut(storeName, key, value) {
    return new Promise((resolve) => {
      if (!this.db) return resolve();
      try {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(Object.assign({}, value, { id: key }));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch { resolve(); }
    });
  },

  // ---- 用户相关（IndexedDB 本地存储，用于 Bmob 不可用时的降级）----
  async getUsers() {
    return this._localGetAll('users');
  },
  async getUser(username) {
    const users = await this._localGetAll('users');
    return users.find(u => u.username === username) || null;
  },
  async saveUser(user) {
    return this._localPut('users', user.username, user);
  },

  // ---- 设置（localStorage，按用户隔离）----
  getSettings(username) {
    const key = `settings_${username}`;
    try { return JSON.parse(localStorage.getItem(key)); } catch { return {}; }
  },
  saveSettings(username, settings) {
    localStorage.setItem(`settings_${username}`, JSON.stringify(settings));
  },

  // ---- 当前登录用户 ----
  setCurrentUser(username) {
    this.currentUser = username;
    localStorage.setItem('currentUser', username);
  },
  getCurrentUser() {
    return this.currentUser || localStorage.getItem('currentUser');
  },
  logout() {
    this.currentUser = null;
    localStorage.removeItem('currentUser');
  },

  // ---- 统计数据快捷方法 ----
  async getTodayFocusMinutes(username) {
    const today = Utils.today();
    const records = await this.getUserData('pomodoro_records', username);
    return records.filter(r => r.date === today && r.completed)
                  .reduce((sum, r) => sum + (r.duration || 0), 0);
  },
  async getTotalFocusMinutes(username) {
    const records = await this.getUserData('pomodoro_records', username);
    return records.filter(r => r.completed).reduce((sum, r) => sum + (r.duration || 0), 0);
  },
  async getTodaySessions(username) {
    const today = Utils.today();
    const records = await this.getUserData('pomodoro_records', username);
    return records.filter(r => r.date === today && r.completed).length;
  },
  async getTodayWordCount(username) {
    const today = Utils.today();
    const words = await this.getUserData('vocab_words', username);
    return words.filter(w => w.firstLearned === today && !w.isWrong).length;
  },
  async getTodayMathCount(username) {
    const today = Utils.today();
    const questions = await this.getUserData('math_questions', username);
    return questions.filter(q => q.createdAt && Utils.cnDate(new Date(q.createdAt)) === today).length;
  },
  async getTodayChatCount(username) {
    const today = Utils.today();
    const chats = await this.getUserData('ai_chats', username);
    return chats.filter(c => c.timestamp && Utils.cnDate(new Date(c.timestamp)) === today).length;
  },

  // ============================================================
  // 金币系统（coins_<user>，单条记录，balance 字段）
  // ============================================================

  async getCoins(username) {
    const user = username || this.getCurrentUser();
    if (!user) return 0;
    try {
      const all = await this.getUserData('coins', user);
      const rec = (all || []).find(r => r.id === 'coins_' + user);
      return Number(rec && rec.balance) || 0;
    } catch (e) { return 0; }
  },

  // 金币读写串行化：避免并发「读余额 → 写回」互相覆盖
  _withCoinLock(fn) {
    const run = this._coinQueue.then(fn, fn);
    this._coinQueue = run.then(() => {}, () => {});
    return run;
  },

  // 云同步失败对用户可见：同一会话内最多 30 秒提示一次，避免刷屏
  _notifyCloudFailure() {
    const now = Date.now();
    if (now - (this._cloudFailToastAt || 0) < 30000) return;
    this._cloudFailToastAt = now;
    try {
      if (typeof Utils !== 'undefined' && Utils.toast) {
        Utils.toast('云端同步失败，数据已保存在本机，联网后会自动重试');
      }
    } catch (e) {}
  },

  async addCoins(username, delta) {
    if (!delta) return 0;
    const user = username || this.getCurrentUser();
    if (!user) return 0;
    return this._withCoinLock(async () => {
      const cur = await this.getCoins(user);
      const next = Math.max(0, cur + delta);
      await this.put('coins', { id: 'coins_' + user, balance: next });
      // 不在这里自动写流水，由上层 Pet.onLearnReward 写更精确的 note
      return next;
    });
  },

  // 扣金币：余额不足返回 -1；成功返回扣后余额
  async spendCoins(username, amount) {
    if (!amount || amount <= 0) return await this.getCoins(username);
    const user = username || this.getCurrentUser();
    if (!user) return -1;
    return this._withCoinLock(async () => {
      const cur = await this.getCoins(user);
      if (cur < amount) return -1;
      const next = cur - amount;
      await this.put('coins', { id: 'coins_' + user, balance: next });
      // 不自动写流水（useItem 会写 item 类型流水）
      return next;
    });
  },

  // ============================================================
  // 金币流水（coin_log_<user>，单条记录）
  // - date = 'YYYY-MM-DD'；每次 addCoins/spendCoins 当 date 与今日不符时自动重置 entries
  // - entries: [{ ts, kind: 'earn'|'spend', source, amount, note }]
  //   source: 'pomodoro'|'vocab'|'article'|'sentence'|'ai_chat'|'item'|'adopt'|'other'
  // ============================================================
  async _ensureCoinLog() {
    const user = this.getCurrentUser();
    if (!user) return null;
    const today = Utils.today();
    let rec = await this.get('coin_log', 'coin_log_' + user);
    if (!rec) {
      rec = { id: 'coin_log_' + user, date: today, entries: [], earnedToday: 0, spentToday: 0 };
      await this.put('coin_log', rec);
      return rec;
    }
    if (rec.date !== today) {
      rec = { id: 'coin_log_' + user, date: today, entries: [], earnedToday: 0, spentToday: 0 };
      await this.put('coin_log', rec);
    }
    return rec;
  },
  async addCoinEntry(source, amount, note) {
    if (!amount || !source) return;
    const user = this.getCurrentUser();
    if (!user) return;
    const rec = await this._ensureCoinLog();
    if (!rec) return;
    const isEarn = amount > 0;
    rec.entries = rec.entries || [];
    rec.entries.push({
      ts: Date.now(),
      kind: isEarn ? 'earn' : 'spend',
      source,
      amount: Math.abs(amount),
      note: note || ''
    });
    // 限定最近 200 条，避免云端 40KB 限制
    if (rec.entries.length > 200) rec.entries = rec.entries.slice(-200);
    if (isEarn) rec.earnedToday = (rec.earnedToday || 0) + Math.abs(amount);
    else rec.spentToday = (rec.spentToday || 0) + Math.abs(amount);
    await this.put('coin_log', rec);
    return rec;
  },
  async getCoinLog(username) {
    const user = username || this.getCurrentUser();
    if (!user) return null;
    const rec = await this._ensureCoinLog();
    return rec;
  },
  async getCoinEarnedToday(username) {
    const log = await this.getCoinLog(username);
    return (log && log.earnedToday) || 0;
  },
  // 按 source 聚合当日收入（用于展示明细）
  async getCoinEarnBreakdown(username) {
    const log = await this.getCoinLog(username);
    if (!log || !log.entries) return [];
    const map = {};
    for (const e of log.entries) {
      if (e.kind !== 'earn') continue;
      map[e.source] = (map[e.source] || 0) + e.amount;
    }
    return Object.entries(map).map(([source, amount]) => ({ source, amount }));
  },

  // ============================================================
  // 宠物系统（pet_<user>，单条记录，含 lvl/exp/mood/hunger/thirst/lastUpdate）
  // ============================================================

  // 衰减参数：每 5 分钟 hunger-1、thirst-1；mood 综合前两者
  _PET_DECAY_INTERVAL_MS: 5 * 60 * 1000,
  _PET_HUNGER_LOSS_PER_TICK: 1,
  _PET_THIRST_LOSS_PER_TICK: 1,
  _PET_SLEEP_START_HOUR: 22,    // 22:00 起宠物睡觉
  _PET_SLEEP_END_HOUR: 8,       // 08:00 起床
  _PET_SLEEP_FACTOR: 0.3,       // 睡眠时段损耗 × 0.3
  _PET_FREE_QUOTA_DAILY: 2,     // 免费道具每日限额

  // 统计 [from, to) 中属于睡眠时段（22:00-08:00）的毫秒数
  _countSleepMs(from, to) {
    const H1 = this._PET_SLEEP_START_HOUR;
    const H2 = this._PET_SLEEP_END_HOUR;
    let sleep = 0;
    let t = from;
    // 跳到下一个整点小时，逐小时推进；最坏 7 天 = 168 步，可接受
    while (t < to) {
      const d = new Date(t);
      const hour = d.getHours();
      const nextHourStart = new Date(d);
      nextHourStart.setHours(hour + 1, 0, 0, 0);
      const segEnd = Math.min(to, nextHourStart.getTime());
      // inSleep：hour >= 22 或 hour < 8（跨午夜）
      const inSleep = (hour >= H1) || (hour < H2);
      if (inSleep) sleep += segEnd - t;
      t = segEnd;
    }
    return sleep;
  },

  _applyDecay(pet) {
    const now = Date.now();
    const last = pet.lastUpdate || now;
    const elapsed = now - last;
    if (elapsed <= 0) return pet;

    // 拆分睡眠/清醒时段损耗
    const sleepMs = this._countSleepMs(last, now);
    const awakeMs = Math.max(0, elapsed - sleepMs);
    const lossPerMs = this._PET_HUNGER_LOSS_PER_TICK / this._PET_DECAY_INTERVAL_MS;

    let hunger = (pet.hunger || 0);
    let thirst = (pet.thirst || 0);
    // 清醒时段：正常扣
    const awakeLoss = awakeMs * lossPerMs * 1.0;
    hunger = Math.max(0, hunger - awakeLoss);
    thirst = Math.max(0, thirst - awakeLoss);
    // 睡眠时段（22:00-08:00）：地板 20，方便白天起来喂养
    if (sleepMs > 0) {
      const sleepLoss = sleepMs * lossPerMs * this._PET_SLEEP_FACTOR;
      hunger = Math.max(20, hunger - sleepLoss);
      thirst = Math.max(20, thirst - sleepLoss);
    }
    pet.hunger = hunger;
    pet.thirst = thirst;
    // 心情 = (hunger+thirst)/2 - 5（最低 0 最高 100）
    pet.mood = Math.max(0, Math.min(100, Math.round((pet.hunger + pet.thirst) / 2 - 5)));
    pet.lastUpdate = now;

    // 饿死 / 渴死 → 等级 -1（最低 lv0），饱食/口渴恢复到 50 防止连环死
    if ((pet.hunger <= 0 || pet.thirst <= 0) && (pet.lvl || 0) > 0) {
      pet.lvl = Math.max(0, (pet.lvl || 1) - 1);
      pet.exp = 0;
      pet.hunger = 50;
      pet.thirst = 50;
      pet.starvationNote = '宠物饿死/渴死，等级降低 1 级';
    }
    return pet;
  },

  async getPet(username) {
    const user = username || this.getCurrentUser();
    if (!user) return null;
    try {
      const all = await this.getUserData('pet_data', user);
      const rec = (all || []).find(r => r.id === 'pet_' + user);
      const pet = rec ? Object.assign({
        lvl: 1, exp: 0, mood: 80, hunger: 80, thirst: 80, lastUpdate: Date.now()
      }, rec) : null;
      if (!pet) return null;
      // 应用时间衰减（不写回云端，避免每次读都触发写）
      return this._applyDecay(pet);
    } catch (e) { return null; }
  },

  // 取宠物并写回（用于衰减后保存，保证下次打开从最新开始计时）
  async loadPetWithPersist(username) {
    const pet = await this.getPet(username);
    if (pet) await this.savePet(pet, { skipDecay: true });
    return pet;
  },

  // 写宠物数据：默认会先应用衰减，避免覆盖未保存的衰减进度
  async savePet(petData, opts) {
    const user = this.getCurrentUser();
    if (!user || !petData) return;
    if (!petData.id) petData.id = 'pet_' + user; // 兜底 id：保证宠物可按 'pet_<user>' 查到/更新/删除，否则每次刷新都重置
    const skipDecay = opts && opts.skipDecay;
    const pet = skipDecay ? Object.assign({}, petData) : this._applyDecay(Object.assign({}, petData));
    pet.username = user;
    pet.lastUpdate = Date.now();
    await this.put('pet_data', pet);
  },

  // 经验升级曲线：exp_to_next(lvl) = 80 * (1 + 0.18*(lvl-1))，不封顶
  expToNext(lvl) {
    return Math.round(80 * (1 + 0.18 * Math.max(0, (lvl || 1) - 1)));
  },

  // 给宠物加经验；返回 { leveledUp, newLvl, expGained }
  async addPetExp(username, exp) {
    if (!exp || exp <= 0) return { leveledUp: false, newLvl: 0, expGained: 0 };
    const user = username || this.getCurrentUser();
    if (!user) return { leveledUp: false, newLvl: 0, expGained: 0 };
    const pet = await this.getPet(user);
    if (!pet) return { leveledUp: false, newLvl: 0, expGained: 0 };
    // 多倍经验药 buff（30 分钟）
    if (pet.expBuffUntil && Date.now() < pet.expBuffUntil) exp = exp * 2;
    pet.exp = (pet.exp || 0) + exp;
    let leveledUp = false;
    while (pet.exp >= this.expToNext(pet.lvl)) {
      pet.exp -= this.expToNext(pet.lvl);
      pet.lvl = (pet.lvl || 1) + 1;
      leveledUp = true;
    }
    await this.savePet(pet);
    return { leveledUp, newLvl: pet.lvl, expGained: exp };
  }
};
