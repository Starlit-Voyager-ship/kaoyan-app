/* ========================================
   桌宠悬浮窗系统
   基于 Ameath 行为模式复刻：
   - 运动状态机：WANDER/FOLLOW/REST
   - 行为模式：QUIET/ACTIVE/CLINGY
   - 动画切换：idle/moving/drag/eating/happy
   - 透明悬浮窗口 + 气泡对话
   ======================================== */

const DesktopPet = {
  el: null,
  bodyEl: null,
  bubbleEl: null,
  visible: false,

  // 位置与运动
  x: 0, y: 0,
  vx: 0, vy: 0,
  targetX: 0, targetY: 0,
  isMoving: false,
  isDragging: false,
  dragOffsetX: 0, dragOffsetY: 0,

  // 行为状态
  motionState: 'WANDER',   // WANDER | FOLLOW | REST
  behaviorMode: 'ACTIVE',  // QUIET | ACTIVE | CLINGY

  // 参数（参考Ameath常量）
  SPEED_WANDER: 0.8,
  SPEED_FOLLOW: 2.5,
  FOLLOW_START_DIST: 200,
  FOLLOW_STOP_DIST: 80,
  INERTIA_FACTOR: 0.92,
  JITTER: 0.3,
  REST_CHANCE: 0.008,
  STOP_CHANCE: 0.01,
  REST_DURATION_MIN: 3000,
  REST_DURATION_MAX: 6000,

  // 定时器
  moveTimer: null,
  restTimer: null,
  bubbleTimer: null,

  // 边界
  bounds: { left: 0, top: 0, right: 0, bottom: 0 },

  // 当前动画状态（用于避免每帧重设 GIF 导致动画重启）
  lastState: null,

  // 问候语
  greetings: [
    '主人加油！今天也要努力学习哦～ 💪',
    '要不要来一个番茄钟？⏰',
    '背几个单词吧！📖',
    '休息一下，喝口水～ 💧',
    '你是最棒的！相信自己！✨',
    '今天的任务完成了吗？',
    '我在这里陪着你呢～ 🐾',
    '累了就歇一会儿，别太拼啦 😴'
  ],

  init() {
    this.el = document.getElementById('desktop-pet');
    this.bodyEl = document.getElementById('dp-pet-body');
    this.bubbleEl = document.getElementById('dp-bubble');

    this.bindEvents();
    this.updateBounds();
    this.setPosition(
      window.innerWidth - 150,
      window.innerHeight - 180
    );

    window.addEventListener('resize', () => this.updateBounds());
  },

  bindEvents() {
    // 拖拽开始
    this.bodyEl.addEventListener('mousedown', (e) => this.onDragStart(e));
    this.bodyEl.addEventListener('touchstart', (e) => this.onDragStart(e), { passive: false });

    // 点击事件
    this.bodyEl.addEventListener('click', (e) => {
      if (!this.isDragging) this.onClick(e);
    });

    // 全局拖拽移动/结束
    document.addEventListener('mousemove', (e) => this.onDragMove(e));
    document.addEventListener('touchmove', (e) => this.onDragMove(e), { passive: false });
    document.addEventListener('mouseup', () => this.onDragEnd());
    document.addEventListener('touchend', () => this.onDragEnd());

    // 双击隐藏
    this.bodyEl.addEventListener('dblclick', () => this.toggleVisibility());
  },

  updateBounds() {
    const size = PetRender.getDesktopSize();
    this.bounds = {
      left: 0,
      top: 0,
      right: window.innerWidth - size,
      bottom: window.innerHeight - size - 60  // 底部留出空间
    };
  },

  setPosition(x, y) {
    this.x = Math.max(this.bounds.left, Math.min(this.bounds.right, x));
    this.y = Math.max(this.bounds.top, Math.min(this.bounds.bottom, y));
    this.el.style.left = this.x + 'px';
    this.el.style.top = this.y + 'px';
  },

  show() {
    const settings = Store.getSettings(Store.getCurrentUser()) || {};
    if (settings.desktopPet === false) return;

    if (!PetCore.data || !PetCore.data.claimed) return;

    this.visible = true;
    this.el.style.display = 'block';
    this.bodyEl.innerHTML = PetRender.getDesktopPetHtml(PetCore.data.petType);
    this.bodyEl.className = 'dp-body idle';
    this.lastState = null;
    this.refreshStateImage();

    // 启动行为循环
    this.startBehaviorLoop();
    // 随机气泡
    this.scheduleRandomBubble();
  },

  hide() {
    this.visible = false;
    this.el.style.display = 'none';
    this.stopMovement();
    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
  },

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  },

  toggleVisibility() {
    this.el.style.opacity = this.el.style.opacity === '0.3' ? '1' : '0.3';
  },

  updatePetImage() {
    if (this.bodyEl && PetCore.data) {
      this.bodyEl.innerHTML = PetRender.getDesktopPetHtml(PetCore.data.petType);
      this.lastState = null;
      this.refreshStateImage();
    }
  },

  // 根据运动状态切换爱弥丝的 GIF（待机/移动/拖拽）
  refreshStateImage() {
    if (!this.bodyEl || !PetCore.data) return;
    const type = PetCore.data.petType || 'ameath';
    if (!PetRender.getPetConfig(type).animated) return; // 小灰熊无需切换
    const state = this.isDragging ? 'drag' : (this.isMoving ? 'move' : 'idle');
    if (state === this.lastState) return;
    this.lastState = state;
    const img = this.bodyEl.querySelector('img');
    if (img) img.src = PetRender.getPetStateImg(type, state);
  },

  playAnimation(type) {
    if (!this.bodyEl) return;
    this.bodyEl.classList.remove('idle', 'moving', 'eating', 'happy');
    this.bodyEl.classList.add(type);
    setTimeout(() => {
      this.bodyEl.classList.remove(type);
      this.bodyEl.classList.add(this.isMoving ? 'moving' : 'idle');
    }, type === 'happy' ? 1800 : 1500);
  },

  // ---- 行为循环 ----
  startBehaviorLoop() {
    this.pickNewTarget();
    this.moveTick();
  },

  pickNewTarget() {
    const size = PetRender.getDesktopSize();
    this.targetX = this.bounds.left + Math.random() * (this.bounds.right - this.bounds.left);
    this.targetY = this.bounds.top + Math.random() * (this.bounds.bottom - this.bounds.top);
  },

  moveTick() {
    if (!this.visible || this.isDragging) {
      this.moveTimer = requestAnimationFrame(() => this.moveTick());
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 到达目标
    if (dist < 5) {
      // 随机决定是否休息
      if (Math.random() < this.REST_CHANCE) {
        this.enterRest();
        return;
      }
      this.pickNewTarget();
    }

    // 计算速度
    let speed = this.SPEED_WANDER;
    if (this.behaviorMode === 'QUIET') speed *= 0.5;
    else if (this.behaviorMode === 'CLINGY') speed *= 1.3;

    // 方向 + 抖动
    const jitterX = (Math.random() - 0.5) * this.JITTER;
    const jitterY = (Math.random() - 0.5) * this.JITTER;

    this.vx = this.vx * this.INERTIA_FACTOR + (dx / dist) * speed + jitterX;
    this.vy = this.vy * this.INERTIA_FACTOR + (dy / dist) * speed + jitterY;

    this.isMoving = Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1;

    this.setPosition(this.x + this.vx, this.y + this.vy);

    // 更新动画状态
    if (this.bodyEl) {
      this.bodyEl.classList.toggle('moving', this.isMoving);
      this.bodyEl.classList.toggle('idle', !this.isMoving);
      this.refreshStateImage();
    }

    this.moveTimer = requestAnimationFrame(() => this.moveTick());
  },

  enterRest() {
    this.isMoving = false;
    this.vx = 0; this.vy = 0;
    if (this.bodyEl) {
      this.bodyEl.classList.remove('moving');
      this.bodyEl.classList.add('idle');
    }

    const restTime = this.REST_DURATION_MIN +
      Math.random() * (this.REST_DURATION_MAX - this.REST_DURATION_MIN);

    this.restTimer = setTimeout(() => {
      this.pickNewTarget();
    }, restTime);
  },

  stopMovement() {
    if (this.moveTimer) cancelAnimationFrame(this.moveTimer);
    if (this.restTimer) clearTimeout(this.restTimer);
    this.vx = 0; this.vy = 0;
    this.isMoving = false;
  },

  // ---- 拖拽 ----
  onDragStart(e) {
    e.preventDefault();
    this.isDragging = true;
    this.stopMovement();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    this.dragOffsetX = clientX - this.x;
    this.dragOffsetY = clientY - this.y;

    this.el.classList.add('dragging');
    if (this.bodyEl) this.bodyEl.classList.add('moving');
    this.refreshStateImage();
  },

  onDragMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    this.setPosition(clientX - this.dragOffsetX, clientY - this.dragOffsetY);
  },

  onDragEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.el.classList.remove('dragging');
    this.refreshStateImage();

    if (this.visible) {
      this.startBehaviorLoop();
    }
  },

  // ---- 交互 ----
  onClick(e) {
    // 显示随机问候语
    const greeting = this.greetings[Math.floor(Math.random() * this.greetings.length)];
    this.showBubble(greeting);
  },

  showBubble(text, duration = 4000) {
    if (!this.bubbleEl) return;
    this.bubbleEl.textContent = text;
    this.bubbleEl.style.display = 'block';

    if (this.bubbleTimer) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      this.bubbleEl.style.display = 'none';
    }, duration);
  },

  scheduleRandomBubble() {
    if (!this.visible) return;
    const delay = 30000 + Math.random() * 60000; // 30-90秒随机
    this.bubbleTimer = setTimeout(() => {
      if (this.visible && PetCore.data && PetCore.data.claimed) {
        const greeting = this.greetings[Math.floor(Math.random() * this.greetings.length)];
        this.showBubble(greeting);
      }
      this.scheduleRandomBubble();
    }, delay);
  }
};
