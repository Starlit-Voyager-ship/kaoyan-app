/* ========================================
   宠物系统 - 核心逻辑
   - 6 种道具 + 价格 + 效果
   - 5 个学习事件钩子（学习获得金币）
   - 初始化宠物（首次进入时种默认值）
   - 状态机：normal / hungry / thirsty / sad / critical
   ======================================== */

const Pet = (() => {
  // ---- 道具表（不引图，色块+文字） ----
  const ITEMS = [
    { id: 'food_pack',  name: '食物包',    price: 30, hunger: 30, thirst: 0,  mood: 0,  exp: 5,  color: '#F2A85C' },
    { id: 'water_pack', name: '饮水包',    price: 30, hunger: 0,  thirst: 30, mood: 0,  exp: 5,  color: '#5DA9D8' },
    { id: 'toy',        name: '小玩具',    price: 50, hunger: 0,  thirst: 0,  mood: 20, exp: 10, color: '#C28BC9' },
    { id: 'feast',      name: '营养大餐',  price: 80, hunger: 50, thirst: 50, mood: 30, exp: 20, color: '#E5BE6A' },
    { id: 'happy_pill', name: '心情药丸',  price: 60, hunger: 0,  thirst: 0,  mood: 50, exp: 5,  color: '#E08196' },
    { id: 'exp_drug',   name: '多倍经验药', price: 100, hunger: 0, thirst: 0, mood: 0, exp: 0, color: '#7C6BC4',
      apply: (pet) => { pet.expBuffUntil = Date.now() + 30 * 60 * 1000; } }
  ];
  const ITEM_BY_ID = Object.fromEntries(ITEMS.map(it => [it.id, it]));

  // ---- 默认初始宠物（首次进入种入） ----
  const DEFAULT_PET = () => ({
    lvl: 1, exp: 0,
    mood: 85, hunger: 85, thirst: 85,
    lastUpdate: Date.now(),
    expBuffUntil: 0
  });

  // ---- 学习行为 → 金币奖励（同时驱动金币流水） ----
  // 与用户拍板的"5 个来源全面铺开"一致
  const LEARN_REWARDS = {
    pomodoro_per_min: 10,    // 番茄钟：每分钟 10 金币
    vocab_per_word: 2,       // 背单词：每熟练一个 2 金币
    article_complete: 20,    // 文章读完 20 金币
    sentence_complete: 15,   // 长难句完成 15 金币
    ai_chat_per_msg: 5       // AI 问答每次 5 金币
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
    return pet;
  }

  // ---- 道具使用 ----
  // 返回 { ok, msg, pet } —— ok=false 时提示金币不足等
  async function useItem(itemId) {
    const item = ITEM_BY_ID[itemId];
    if (!item) return { ok: false, msg: '道具不存在' };
    const user = Store.getCurrentUser();
    if (!user) return { ok: false, msg: '请先登录' };
    const remaining = await Store.spendCoins(user, item.price);
    if (remaining < 0) return { ok: false, msg: '金币不足' };

    const pet = await loadPet();
    pet.hunger = Math.min(100, (pet.hunger || 0) + (item.hunger || 0));
    pet.thirst = Math.min(100, (pet.thirst || 0) + (item.thirst || 0));
    pet.mood   = Math.min(100, (pet.mood   || 0) + (item.mood   || 0));
    if (item.apply) item.apply(pet);

    await Store.savePet(pet);
    if (item.exp) await Store.addPetExp(user, item.exp);
    return { ok: true, msg: `已使用 ${item.name}`, pet: await Store.getPet(user) };
  }

  // ---- 抚摸（点宠物身体） —— 心情 +5，不扣金币，无道具 ----
  async function pet() {
    const user = Store.getCurrentUser();
    if (!user) return null;
    const pet = await loadPet();
    pet.mood = Math.min(100, (pet.mood || 0) + 5);
    await Store.savePet(pet);
    return Store.getPet(user);
  }

  // ---- 学习事件钩子 ----
  // 其他模块：Pomodoro/Vocabulary/Articles/Sentences/AIAssistant 在相应节点调用
  async function onLearnReward(type, count) {
    if (!count || count <= 0) return 0;
    const per = LEARN_REWARDS[type];
    if (!per) return 0;
    const delta = per * count;
    return await Store.addCoins(null, delta);
  }

  // ---- UI 状态聚合（页面渲染用） ----
  async function snapshot() {
    const user = Store.getCurrentUser();
    if (!user) return null;
    const pet = await loadPet();
    const coins = await Store.getCoins(user);
    const expToNext = Store.expToNext(pet.lvl);
    return {
      pet,
      state: getState(pet),
      coins,
      expToNext,
      items: ITEMS,
      learnRewards: LEARN_REWARDS
    };
  }

  return {
    ITEMS, ITEM_BY_ID, LEARN_REWARDS,
    loadPet, useItem, pet, onLearnReward, snapshot, getState,
    DEFAULT_PET
  };
})();

if (typeof window !== 'undefined') window.Pet = Pet;