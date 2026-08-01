/* ========================================
   数据存储层 - IndexedDB + localStorage
   ======================================== */

const Store = {
  db: null,
  dbName: 'KaoyanHelperDB',
  currentUser: null,

  async init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // 用户表
        if (!db.objectStoreNames.contains('users')) {
          const us = db.createObjectStore('users', { keyPath: 'username' });
          us.createIndex('inviteCode', 'inviteCode', { unique: true });
        }

        // 各模块数据表（均以 username+id 为复合设计，通过前缀隔离）
        const stores = [
          'pomodoro_records',     // 番茄钟记录
          'ai_chats',             // AI对话记录
          'vocab_words',          // 单词库
          'articles',             // 文章
          'sentences',            // 长难句
          'essays',               // 作文模板
          'math_questions',       // 数学题库
          'math_weak_points',     // 薄弱错题
          'pet_data',             // 宠物数据
          'friend_bindings',      // 好友绑定
          'reports'               // 报表缓存
        ];
        stores.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = (e) => reject(e.target.error);
    });
  },

  // ---- 通用CRUD ----
  async put(storeName, data) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(data.username ? storeName : storeName).put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },
  async get(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async getAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  },
  async delete(storeName, id) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },
  async clear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = (e) => reject(e.target.error);
    });
  },

  // ---- 按用户过滤 ----
  async getUserData(storeName, username) {
    const all = await this.getAll(storeName);
    return all.filter(item => item.username === username);
  },

  // ---- 用户相关 ----
  async getUsers() {
    return this.getAll('users');
  },
  async getUser(username) {
    return this.get('users', username);
  },
  async saveUser(user) {
    return this.put('users', user);
  },

  // ---- 设置（localStorage）----
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
    return records
      .filter(r => r.date === today && r.completed)
      .reduce((sum, r) => sum + (r.duration || 0), 0);
  },

  async getTotalFocusMinutes(username) {
    const records = await this.getUserData('pomodoro_records', username);
    return records
      .filter(r => r.completed)
      .reduce((sum, r) => sum + (r.duration || 0), 0);
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
    const petData = await this.getPetData(username);
    return petData?.coins || 0;
  },

  async addCoins(username, amount) {
    const petData = await this.getPetData(username);
    if (petData) {
      petData.coins = (petData.coins || 0) + amount;
      await this.put('pet_data', petData);
      return petData.coins;
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
