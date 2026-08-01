/* ========================================
   宠物渲染系统
   默认宠物：爱弥丝（Ameath 动画模型）
   备选宠物：小灰熊（用户提供的 animal_only.png）
   两套形象共用同一套行为逻辑，仅外观不同。
   ======================================== */

const PetRender = {
  // 宠物形象配置
  PET_TYPES: {
    // 默认宠物：爱弥丝（多态 GIF 动画）
    ameath: {
      name: '爱弥丝',
      animated: true,
      // 各行为状态对应的 GIF（参考 Ameath 资源命名）
      gifs: {
        idle: [
          'assets/pet/ameath_idle1.gif',
          'assets/pet/ameath_idle2.gif',
          'assets/pet/ameath_idle3.gif',
          'assets/pet/ameath_idle4.gif'
        ],
        move: 'assets/pet/ameath_move.gif',
        drag: 'assets/pet/ameath_drag.gif'
      },
      // 大图/缩略图展示用（1000x1000 主形象）
      preview: 'assets/pet/ameath_main.gif'
    },
    // 备选宠物：小灰熊（静态 PNG，仅替换形象）
    bear: {
      name: '小灰熊',
      animated: false,
      image: 'assets/pet/custom_pet.png',
      preview: 'assets/pet/custom_pet.png'
    }
  },

  getPetConfig(type) {
    return this.PET_TYPES[type] || this.PET_TYPES.ameath;
  },

  getPetName(type) {
    return this.getPetConfig(type).name;
  },

  getPetPreview(type) {
    return this.getPetConfig(type).preview;
  },

  // 大图头像展示（宠物页面）
  getPetEmoji(type) {
    const cfg = this.getPetConfig(type);
    const src = cfg.animated ? cfg.gifs.idle[0] : cfg.image;
    return `<img src="${src}" alt="${cfg.name}" style="width:120px;height:120px;border-radius:16px;object-fit:contain;background:rgba(255,255,255,0.4)">`;
  },

  // 桌宠悬浮窗 HTML（默认待机动画）
  getDesktopPetHtml(type) {
    const cfg = this.getPetConfig(type);
    const src = cfg.animated ? cfg.gifs.idle[0] : cfg.image;
    return `<img src="${src}" alt="${cfg.name}" draggable="false"
            style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.18))">`;
  },

  // 根据行为状态返回对应 GIF（仅爱弥丝需要切换）
  getPetStateImg(type, state) {
    const cfg = this.getPetConfig(type);
    if (!cfg.animated) return null;
    if (state === 'move') return cfg.gifs.move;
    if (state === 'drag') return cfg.gifs.drag;
    // idle：在 4 个待机动画中随机选一个，增加灵动感
    const arr = cfg.gifs.idle;
    return arr[Math.floor(Math.random() * arr.length)];
  },

  // 获取桌宠尺寸
  getDesktopSize() {
    return window.innerWidth <= 640 ? 90 : 120;
  }
};
