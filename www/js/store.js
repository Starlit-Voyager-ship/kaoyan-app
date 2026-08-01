/* ========================================
   数据存储层 - Bmob 云同步 + 本地 IndexedDB 缓存
   多端互通：登录后数据写入云端，换设备登录同账号自动拉取
   数据隔离：每条云端记录带 userId + ACL，各账号仅可读写自己的数据
   ======================================== */

const Store = {
  db: null,
  dbName: 'KaoyanHelperDB',
  currentUser: null,

  async init() {
    // 初始化本地缓存库（始终可用，离线兜底）
    await this._initLocal();
    // 初始化 Bmob（云端同步）
    Bmob.init(window.APP_CONFIG && window.APP_CONFIG.bmob);
    return;
  },

  _initLocal() {
    return new Promise((resolve) => {
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
      req.onerror = () => resolve(); // 即使本地库失败也不阻塞
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
      catch (e) { console.warn('[Store] 云端保存失败（稍后联网重试）', e.message); }
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
      try { await Bmob.deleteAppData(storeName, id); } catch (e) {}
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
    if (Bmob.isLoggedIn() && Bmob.username === username) {
      try {
        const items = await Bmob.getAppData(storeName);
        // 同步到本地缓存
        for (const it of items) {
          await this._cachePut(`${username}::${storeName}::${it.id}`, it);
        }
        return items;
      } catch (e) {
        console.warn('[Store] 云端读取失败，回落本地缓存', e.message);
      }
    }
    return this._getUserDataFromCache(storeName, username);
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
    return questions.filter(q => q.createdAt && q.createdAt.startsWith(today)).length;
  },
  async getCoins(username) {
    const pet = await this.getPetData(username);
    return pet?.coins || 0;
  },
  async addCoins(username, amount) {
    const pet = await this.getPetData(username);
    if (pet) {
      pet.coins = (pet.coins || 0) + amount;
      await this.put('pet_data', pet);
      return pet.coins;
    }
    return 0;
  },

  // ---- 宠物数据 ----
  async getPetData(username) {
    const data = await this.getUserData('pet_data', username);
    return data.find(p => p.username === username) || null;
  },
  async savePetData(petData) {
    return this.put('pet_data', petData);
  }
};
