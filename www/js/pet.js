/* ========================================
   宠物系统 - 核心逻辑
   - 6 种道具 + 价格 + 效果
   - 5 个学习事件钩子（学习获得金币）
   - 初始化宠物（首次进入时种默认值）
   - 状态机：normal / hungry / thirsty / sad / critical
   - 多种宠物类型（领养选择）
   ======================================== */

const Pet = (() => {
  // ---- 道具表（不引图，色块+文字） ----
  // - price=0 视为免费道具：消耗每日免费额度（默认 2 份/天），不涨经验
  // - exp=0 表示不涨经验（与免费道具搭配）
  const ITEMS = [
    { id: 'food_pack',  name: '食物包',    price: 30, hunger: 30, thirst: 0,  mood: 0,  exp: 5,  color: '#F2A85C' },
    { id: 'water_pack', name: '饮水包',    price: 30, hunger: 0,  thirst: 30, mood: 0,  exp: 5,  color: '#5DA9D8' },
    { id: 'toy',        name: '小玩具',    price: 50, hunger: 0,  thirst: 0,  mood: 20, exp: 10, color: '#C28BC9' },
    { id: 'feast',      name: '营养大餐',  price: 80, hunger: 50, thirst: 50, mood: 30, exp: 20, color: '#E5BE6A' },
    { id: 'happy_pill', name: '心情药丸',  price: 60, hunger: 0,  thirst: 0,  mood: 50, exp: 5,  color: '#E08196' },
    { id: 'exp_drug',   name: '多倍经验药', price: 100, hunger: 0, thirst: 0, mood: 0, exp: 0, color: '#7C6BC4',
      apply: (pet) => { pet.expBuffUntil = Date.now() + 30 * 60 * 1000; } },
    // 应急免费道具：每天限 2 份，恢复约 20% 各项属性，不涨经验，防止宠物饿死
    { id: 'free_water', name: '矿泉水',    price: 0,  hunger: 0,  thirst: 20, mood: 5,  exp: 0, color: '#7EC2E8', free: true },
    { id: 'free_bread', name: '面包',      price: 0,  hunger: 20, thirst: 5,  mood: 5,  exp: 0, color: '#E0A875', free: true },
    { id: 'free_toy',   name: '玩具',      price: 0,  hunger: 0,  thirst: 0,  mood: 20, exp: 0, color: '#C28BC9', free: true }
  ];
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map(it => [it.id, it]));

  // ---- 宠物类型表（用户可在领养对话框中选择） ----
  // - gifs=null 表示静态图（由 CSS animation 提供 idle 动感）
  // - preview：领养对话框缩略图；main：panel 顶部/默认展示；gifs：5s 切换的 idle 动画
  const PET_TYPES = {
    ameath: {
      id: 'ameath',
      name: 'Ameath',
      accent: '#6E5CA8',
      preview: './assets/pet/ameath_main.gif',
      main:    './assets/pet/ameath_main.gif',
      gifs: [
        './assets/pet/ameath_idle1.gif',
        './assets/pet/ameath_idle2.gif',
        './assets/pet/ameath_idle3.gif',
        './assets/pet/ameath_idle4.gif',
        './assets/pet/ameath_main.gif'
      ]
    },
    chibi: {
      id: 'chibi',
      name: '小萌',
      accent: '#E07A9F',
      preview: './assets/pet/chibi.png',
      main:    './assets/pet/chibi.png',
      gifs:    null
    }
  };
  const DEFAULT_TYPE = 'ameath';

  // ---- 默认初始宠物（首次进入种入） ----
  const DEFAULT_PET = () => ({
    petType: null,      // null = 待用户领养选择；首次进入弹领养框
    lvl: 1, exp: 0,
    mood: 85, hunger: 85, thirst: 85,
    lastUpdate: Date.now(),
    expBuffUntil: 0
  });

  // ---- 学习行为 → 金币奖励（同时驱动金币流水） ----
  const LEARN_REWARDS = {
    pomodoro_per_min: { source: 'pomodoro', per: 1,   name: '专注' },
    vocab_per_word:    { source: 'vocab',    per: 1,   name: '单词' },
    article_complete:  { source: 'article',  per: 100, name: '文章阅读' },
    sentence_complete: { source: 'sentence', per: 15,  name: '长难句' },
    ai_chat_per_msg:   { source: 'ai_chat',  per: 3,   name: 'AI对话' }
  };

  // ---- 状态机：根据 mood/hunger/thirst 决定宠物表情与提示 ----
  function getState(pet) {
    const { mood = 0, hunger = 0, thirst = 0 } = pet;
    if (hunger <= 15 || thirst <= 15) return { key: 'critical', label: '危险', emoji: '饿/渴', priority: 3 };
    if (hunger <= 35 || thirst <= 35) return { key: 'hungry',   label: '饥渴', emoji: '…',      priority: 2 };
    if (mood <= 35) return { key: 'sad',    label: '不开心', emoji: '…',      priority: 1 };
    return { key: 'normal', label: '开心',   emoji: '!',      priority: 0 };
  }

  // ---- 加载宠物数据（首次进入种入默认值） ----
  async function loadPet() {
    const user = Store.getCurrentUser();
    if (!user) return null;
    let pet = await Store.getPet(user);
    if (!pet) {
      pet = DEFAULT_PET();
      await Store.savePet(pet);
    }
    // 兼容旧 pet 没有 petType 字段 —— 视为已领养 ameath
    if (pet.petType === undefined) {
      pet.petType = DEFAULT_TYPE;
      await Store.savePet(pet);
    }
    return pet;
  }

  // ---- 领养/切换宠物 ----
  async function adopt(type) {
    if (!PET_TYPES[type]) return null;
    const user = Store.getCurrentUser();
    if (!user) return null;
    const pet = await loadPet();
    pet.petType = type;
    await Store.savePet(pet);
    return pet;
  }

  // ---- 当前宠物的素材 ----
  function getAssets(pet) {
    const t = (pet && pet.petType && PET_TYPES[pet.petType]) || PET_TYPES[DEFAULT_TYPE];
    return t;
  }

  // ---- 道具使用 ----
  async function useItem(itemId) {
    const item = ITEM_BY_ID[itemId];
    if (!item) return { ok: false, msg: '道具不存在' };
    const user = Store.getCurrentUser();
    if (!user) return { ok: false, msg: '请先登录' };

    // 免费道具：先检查/重置每日 quota
    if (item.free) {
      const quotaPet = await loadPet();
      const today = (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toISOString().slice(0, 10);
      if (quotaPet.freeQuotaDate !== today) {
        quotaPet.freeQuotaDate = today;
        quotaPet.freeQuotaUsed = 0;
      }
      const dailyQuota = (typeof Store !== 'undefined' && Store._PET_FREE_QUOTA_DAILY) || 2;
      if ((quotaPet.freeQuotaUsed || 0) >= dailyQuota) {
        return { ok: false, msg: '今天的应急道具已用完（每天 2 份）' };
      }
      quotaPet.freeQuotaUsed = (quotaPet.freeQuotaUsed || 0) + 1;
      await Store.savePet(quotaPet);
    } else if (item.price > 0) {
      const remaining = await Store.spendCoins(user, item.price);
      if (remaining < 0) return { ok: false, msg: '金币不足' };
      await Store.addCoinEntry('item', -item.price, item.name);
    }

    const pet = await loadPet();
    pet.hunger = Math.min(100, (pet.hunger || 0) + (item.hunger || 0));
    pet.thirst = Math.min(100, (pet.thirst || 0) + (item.thirst || 0));
    pet.mood   = Math.min(100, (pet.mood   || 0) + (item.mood   || 0));
    if (item.apply) item.apply(pet);

    await Store.savePet(pet);
    // 免费道具不涨经验
    if (item.exp && !item.free) await Store.addPetExp(user, item.exp);
    return { ok: true, msg: `已使用 ${item.name}`, pet: await Store.getPet(user) };
  }

  // ---- 读取今日免费道具剩余额度（UI 显示用） ----
  async function getFreeQuota() {
    const user = Store.getCurrentUser();
    if (!user) return { used: 0, total: 2, date: '' };
    const pet = await loadPet();
    const today = (typeof Utils !== 'undefined' && Utils.today) ? Utils.today() : new Date().toISOString().slice(0, 10);
    const total = (typeof Store !== 'undefined' && Store._PET_FREE_QUOTA_DAILY) || 2;
    if (pet.freeQuotaDate !== today) return { used: 0, total, date: today };
    return { used: pet.freeQuotaUsed || 0, total, date: today };
  }

  // ---- 抚摸（点宠物身体） ----
  async function pet() {
    const user = Store.getCurrentUser();
    if (!user) return null;
    const pet = await loadPet();
    pet.mood = Math.min(100, (pet.mood || 0) + 5);
    await Store.savePet(pet);
    return Store.getPet(user);
  }

  // ---- 学习事件钩子 ----
  // - kind: 'pomodoro_per_min' | 'vocab_per_word' | 'article_complete' | 'sentence_complete' | 'ai_chat_per_msg'
  // - count: 真实数量（如分钟数、词数），写流水时按 count × per 计
  // - extra: 可选 { unit: '分钟'|'词', note } 用于显示在流水上
  async function onLearnReward(kind, count, extra) {
    if (!count || count <= 0) return 0;
    const cfg = LEARN_REWARDS[kind];
    if (!cfg) return 0;
    const delta = cfg.per * count;
    const next = await Store.addCoins(null, delta);
    const note = (extra && extra.note) || (cfg.name + (count > 1 ? ` × ${count}` : ''));
    await Store.addCoinEntry(cfg.source, delta, note);
    return next;
  }

  // ---- UI 状态聚合（页面渲染用） ----
  async function snapshot() {
    const user = Store.getCurrentUser();
    if (!user) return null;
    const pet = await loadPet();
    const coins = await Store.getCoins(user);
    const coinLog = await Store.getCoinLog(user);
    const expToNext = Store.expToNext(pet.lvl);
    const freeQuota = await getFreeQuota();
    return {
      pet,
      state: getState(pet),
      coins,
      earnedToday: (coinLog && coinLog.earnedToday) || 0,
      spentToday:  (coinLog && coinLog.spentToday) || 0,
      entries:     (coinLog && coinLog.entries) || [],
      expToNext,
      items: ITEMS,
      learnRewards: LEARN_REWARDS,
      assets: getAssets(pet),
      petTypes: PET_TYPES,
      freeQuota
    };
  }

  return {
    ITEMS, ITEM_BY_ID, LEARN_REWARDS,
    PET_TYPES, DEFAULT_TYPE,
    loadPet, adopt, getAssets, useItem, getFreeQuota, pet, onLearnReward, snapshot, getState,
    DEFAULT_PET
  };
})();

if (typeof window !== 'undefined') window.Pet = Pet;
