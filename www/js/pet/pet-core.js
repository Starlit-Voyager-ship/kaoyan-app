/* ========================================
   宠物养成系统核心
   ======================================== */

const PetCore = {
  data: null,

  // 等级经验表
  levelExp: [0, 50, 120, 210, 330, 480, 660, 880, 1140, 1450, 1820, 2260, 2770, 3360, 4040],

  init() {
    this.load();
    this.render();
    this.startDecayLoop();
  },

  async load() {
    const user = Store.getCurrentUser();
    this.data = await Store.getPetData(user);
    if (!this.data) {
      // 初始化
      this.data = {
        id: `pet_${user}`,
        username: user,
        claimed: false,
        name: '',
        level: 1,
        exp: 0,
        coins: 0,
        mood: 80,
        hunger: 80,
        thirst: 80,
        petType: 'ameath',
        inventory: { food: 0, water: 0, treat: 0 },
        totalCoinsEarned: 0,
        createdAt: new Date().toISOString()
      };
      await Store.savePetData(this.data);
    }
  },

  async save() {
    await Store.savePetData(this.data);
  },

  render() {
    if (!this.data) return;

    // 宠物展示
    const avatarEl = document.getElementById('pet-avatar-large');
    if (this.data.claimed) {
      avatarEl.innerHTML = PetRender.getPetEmoji(this.data.petType);
    } else {
      avatarEl.innerHTML = '🎁';
    }

    // 信息
    document.getElementById('pet-name-display').textContent =
      this.data.claimed ? this.data.name : '未领取';
    document.getElementById('pet-level').textContent = this.data.level;

    // 经验条
    const currentLevelExp = this.levelExp[this.data.level - 1] || 0;
    const nextLevelExp = this.levelExp[this.data.level] || this.levelExp[this.levelExp.length - 1];
    const expProgress = ((this.data.exp - currentLevelExp) / (nextLevelExp - currentLevelExp)) * 100;
    document.getElementById('pet-exp-fill').style.width = `${Math.min(100, Math.max(0, expProgress))}%`;

    // 状态条
    document.getElementById('pet-mood-bar').style.width = `${this.data.mood}%`;
    document.getElementById('pet-hunger-bar').style.width = `${this.data.hunger}%`;
    document.getElementById('pet-thirst-bar').style.width = `${this.data.thirst}%`;

    // 金币
    document.getElementById('pet-coins-count').textContent = this.data.coins;

    // 按钮
    document.getElementById('claim-pet-btn').style.display = this.data.claimed ? 'none' : 'inline-block';
    document.getElementById('feed-pet-btn').style.display = this.data.claimed ? 'inline-block' : 'none';
    document.getElementById('switch-pet-btn').style.display = this.data.claimed ? 'inline-block' : 'none';
    const petSelect = document.getElementById('pet-select');
    if (petSelect) petSelect.style.display = this.data.claimed ? 'flex' : 'none';
    // 高亮当前形象
    document.querySelectorAll('.pet-choice').forEach(b => {
      b.classList.toggle('active', b.dataset.type === this.data.petType);
    });

    // 首页预览
    const homeMini = document.getElementById('home-pet-mini');
    const homeName = document.getElementById('home-pet-name');
    if (this.data.claimed) {
      homeMini.innerHTML = `<span style="font-size:3rem">${PetRender.getPetEmoji(this.data.petType)}</span>`;
      homeName.textContent = `${this.data.name} · Lv.${this.data.level}`;
    } else {
      homeMini.innerHTML = '<span style="font-size:3rem">🎁</span>';
      homeName.textContent = '点击领取你的专属宠物';
    }

    document.getElementById('home-coins').textContent = this.data.coins;
  },

  async claimPet() {
    if (this.data.claimed) return;

    Utils.showModal('🎁 领取专属宠物', `
      <div style="text-align:center">
        <div style="font-size:4rem;margin-bottom:12px">${PetRender.getPetEmoji('ameath')}</div>
        <p>你将获得一只专属学习宠物 —— <b>爱弥丝</b>！它会陪伴你的考研之路。</p>
        <p style="font-size:0.85rem;color:#888">（之后也可在页面底部切换为「小灰熊」形象，行为逻辑完全一致）</p>
        <div class="input-group" style="margin-top:16px;text-align:left">
          <label>给宠物起个名字</label>
          <input type="text" id="claim-pet-name" placeholder="如：小灰、学霸..." class="setting-input" value="">
        </div>
      </div>
    `, `<button class="btn-primary" id="confirm-claim">确认领取</button>
       <button class="btn-outline" onclick="Utils.hideModal()">再想想</button>`);

    document.getElementById('confirm-claim').onclick = () => {
      const name = document.getElementById('claim-pet-name').value.trim() || '小可爱';
      this.doClaim(name);
    };

    // 回车确认
    document.getElementById('claim-pet-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('confirm-claim').click();
    });
  },

  async doClaim(name) {
    this.data.claimed = true;
    this.data.name = name;
    this.data.mood = 100;
    this.data.hunger = 100;
    this.data.thirst = 100;
    await this.save();

    Utils.hideModal();
    Utils.toast(`🎉 领取成功！${name} 成为了你的专属宠物！`);

    this.render();
    DesktopPet.show();
  },

  // 直接设定宠物形象（爱弥丝 / 小灰熊）
  async setPetType(type) {
    if (!this.data.claimed) return;
    if (!PetRender.PET_TYPES[type]) return;
    if (this.data.petType === type) return;
    this.data.petType = type;
    await this.save();
    this.render();
    DesktopPet.updatePetImage();
    Utils.toast(`已切换为「${PetRender.getPetName(type)}」形象`);
  },

  async feed(itemType) {
    if (!this.data.claimed) return;

    const costs = { food: 10, water: 5, treat: 25 };
    const cost = costs[itemType];

    if (this.data.coins < cost) {
      Utils.toast('金币不足！');
      return;
    }

    this.data.coins -= cost;

    switch (itemType) {
      case 'food':
        this.data.hunger = Math.min(100, this.data.hunger + 25);
        this.data.mood = Math.min(100, this.data.mood + 5);
        break;
      case 'water':
        this.data.thirst = Math.min(100, this.data.thirst + 20);
        this.data.mood = Math.min(100, this.data.mood + 3);
        break;
      case 'treat':
        this.data.hunger = Math.min(100, this.data.hunger + 15);
        this.data.thirst = Math.min(100, this.data.thirst + 10);
        this.data.mood = Math.min(100, this.data.mood + 15);
        this.addExp(10);
        break;
    }

    await this.save();
    this.render();

    const itemNames = { food: '🍖 食物', water: '🥤 饮水', treat: '🍰 零食' };
    Utils.toast(`${itemNames[itemType]} 喂养成功！`);

    // 触发桌宠动画
    if (itemType === 'treat') DesktopPet.playAnimation('happy');
    else DesktopPet.playAnimation('eating');
  },

  addExp(amount) {
    this.data.exp += amount;

    // 升级检查
    while (this.data.level < this.levelExp.length &&
           this.data.exp >= (this.levelExp[this.data.level] || Infinity)) {
      this.data.level++;
      Utils.toast(`🎉 宠物升级了！当前等级 Lv.${this.data.level}`);
    }

    this.render();
  },

  // 每30秒衰减一次状态
  startDecayLoop() {
    setInterval(() => {
      if (!this.data || !this.data.claimed) return;

      this.data.hunger = Math.max(0, this.data.hunger - 0.5);
      this.data.thirst = Math.max(0, this.data.thirst - 0.6);

      // 低状态影响心情
      if (this.data.hunger < 30 || this.data.thirst < 30) {
        this.data.mood = Math.max(0, this.data.mood - 0.3);
      }

      this.render();
    }, 30000);
  }
};

// 绑定事件
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('claim-pet-btn')?.addEventListener('click', () => PetCore.claimPet());
  document.getElementById('feed-pet-btn')?.addEventListener('click', () => {
    if (PetCore.data.inventory.food > 0) {
      PetCore.data.inventory.food--;
      PetCore.data.hunger = Math.min(100, PetCore.data.hunger + 15);
      PetCore.save(); PetCore.render();
      Utils.toast('喂食成功！');
    } else {
      Utils.showModal('🍖 喂养宠物', '<p>选择要购买的物品：</p>', '');
      // 商店逻辑在页面按钮绑定中处理
    }
  });

  // 商店购买按钮
  document.querySelectorAll('.buy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.dataset.item;
      const price = parseInt(btn.dataset.price);
      PetCore.feed(item);
    });
  });

  document.getElementById('switch-pet-btn')?.addEventListener('click', () => {
    const types = ['ameath', 'bear'];
    const currentIndex = types.indexOf(PetCore.data.petType || 'ameath');
    const nextIndex = (currentIndex + 1) % types.length;
    PetCore.setPetType(types[nextIndex]);
  });

  // 形象选择卡片
  document.querySelectorAll('.pet-choice').forEach(btn => {
    btn.addEventListener('click', () => {
      PetCore.setPetType(btn.dataset.type);
    });
  });
});
