/* ========================================
   宠物小窝 - UI 渲染层
   - 顶部状态卡：心情/饱食/口渴 + lv + 金币余额
   - 中部小窝：宠物 GIF + 互动反馈（点击抚摸）
   - 底部动作：喂食/饮水/玩耍/抚摸 + 道具商店入口
   - 道具商店浮层：6 样道具卡
   - 衰减 tick（每 30 秒刷新一次状态条，5 分钟真正减属性）
   ======================================== */

const PetUI = (() => {
  const SHELL_ID = 'pet-app';
  let _decayTimer = null;
  let _idleTimer = null;
  let _currentGifIdx = 0;
  // GIF 资源（assets/pet/ 下）—— 移动资源后用 ./assets/pet/...
  const PET_GIFS = [
    './assets/pet/ameath_idle1.gif',
    './assets/pet/ameath_idle2.gif',
    './assets/pet/ameath_idle3.gif',
    './assets/pet/ameath_idle4.gif',
    './assets/pet/ameath_main.gif'
  ];

  function _el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _bar(key, label, value) {
    return `<div class="stat-bar">
      <span class="lbl">${label}</span>
      <div class="stat-track"><div class="stat-fill ${key}" style="width:${Math.round(value)}%"></div></div>
      <span class="num">${Math.round(value)}</span>
    </div>`;
  }

  function _particleIcon(key) {
    // 改为纯色 SVG（避免 emoji），按 key 给定颜色与形状
    const map = {
      feed:  { color: '#E0914E', shape: 'circle' },
      water: { color: '#4F9CD0', shape: 'drop' },
      play:  { color: '#C28BC9', shape: 'star' },
      pet:   { color: '#E07A9F', shape: 'heart' },
      feast: { color: '#E5BE6A', shape: 'circle' },
      happy: { color: '#FF8FB1', shape: 'heart' },
      exp:   { color: '#7C6BC4', shape: 'star' }
    };
    const cfg = map[key] || { color: '#7C6BC4', shape: 'star' };
    let path = '';
    if (cfg.shape === 'circle') path = '<circle cx="16" cy="16" r="11"/>';
    else if (cfg.shape === 'drop') path = '<path d="M16 4c4 6 8 11 8 16a8 8 0 1 1-16 0c0-5 4-10 8-16z"/>';
    else if (cfg.shape === 'star') path = '<path d="M16 4l3 9h9l-7.5 5.5 3 9-7.5-5.5L8.5 27.5l3-9L4 13h9z"/>';
    else if (cfg.shape === 'heart') path = '<path d="M16 28s-11-7-11-16a6 6 0 0 1 11-3.7A6 6 0 0 1 27 12c0 9-11 16-11 16z"/>';
    return `<svg viewBox="0 0 32 32" width="32" height="32" style="fill:${cfg.color};stroke:#fff;stroke-width:1.5;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.15))">${path}</svg>`;
  }

  function _spawnParticle(stage, key) {
    const p = _el(`<div class="pet-particle">${_particleIcon(key)}</div>`);
    const rect = stage.getBoundingClientRect();
    const x = rect.width / 2 + (Math.random() * 60 - 30);
    p.style.left = x + 'px';
    p.style.bottom = '90px';
    stage.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  function _showToast(msg) {
    const t = _el(`<div class="pet-toast">${_esc(msg)}</div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }

  // 切换 GIF（待机随机 / 互动切换为 main.gif）
  function _nextGif(forceMain) {
    const img = document.getElementById('pet-stage-img');
    if (!img) return;
    if (forceMain) {
      img.src = PET_GIFS[4] + '?t=' + Date.now();
      return;
    }
    _currentGifIdx = (_currentGifIdx + 1 + Math.floor(Math.random() * 3)) % 4;
    img.src = PET_GIFS[_currentGifIdx] + '?t=' + Date.now();
  }

  function _renderStatsCard(snap) {
    const { pet, state, coins, expToNext } = snap;
    const pct = (pet.exp / expToNext) * 100;
    const tagCls = state.key;
    return `
      <div class="pet-stats">
        <div class="pet-stats-head">
          <div>
            <span class="pet-lvl">Lv.${pet.lvl}</span>
            <span class="pet-state-tag ${tagCls}">${_esc(state.label)}</span>
          </div>
          <span class="pet-coins">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="12" r="8.5" fill="#E5BE6A"/><text x="12" y="16" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">¥</text></svg>
            ${coins}
          </span>
        </div>
        ${_bar('mood',   '心情', pet.mood)}
        ${_bar('hunger', '饱食', pet.hunger)}
        ${_bar('thirst', '口渴', pet.thirst)}
        ${_bar('exp',    '经验', pct)}
      </div>
    `;
  }

  function _renderStage(snap) {
    return `
      <div class="pet-stage" id="pet-stage">
        <img class="pet-stage-img" id="pet-stage-img"
             src="${PET_GIFS[4]}"
             alt="宠物 Ameath"
             draggable="false">
      </div>
    `;
  }

  function _renderActions() {
    const buttons = [
      { key: 'feed',  label: '喂食', icon: '<path d="M5 12c-1-3 1-5 4-5s5 1 6 4 0 5-3 6-6-1-7-5z"/>' },
      { key: 'water', label: '饮水', icon: '<path d="M12 4c2 3 4 6 4 9a4 4 0 1 1-8 0c0-3 2-6 4-9z"/>' },
      { key: 'play',  label: '玩耍', icon: '<circle cx="12" cy="12" r="3.5"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>' },
      { key: 'pet',   label: '抚摸', icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>' }
    ];
    return `
      <div class="pet-actions">
        ${buttons.map(b => `
          <button class="pet-action-btn" data-key="${b.key}">
            <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${b.icon}</svg>
            <span>${b.label}</span>
          </button>
        `).join('')}
      </div>
      <button class="pet-shop-btn" id="pet-shop-open">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 8h14l-1.5 11a2 2 0 0 1-2 1.7H8.5a2 2 0 0 1-2-1.7L5 8z"/>
          <path d="M9 8a3 3 0 0 1 6 0"/>
        </svg>
        <span>道具商店</span>
      </button>
    `;
  }

  function _renderShop(snap) {
    return `
      <div class="pet-shop">
        ${snap.items.map(it => {
          const desc = [];
          if (it.hunger) desc.push(`饱食+${it.hunger}`);
          if (it.thirst) desc.push(`口渴+${it.thirst}`);
          if (it.mood)   desc.push(`心情+${it.mood}`);
          if (it.exp)    desc.push(`+${it.exp} 经验`);
          if (it.expBuffMs) desc.push('30分钟内经验×2');
          const affordable = snap.coins >= it.price;
          return `
            <button class="pet-shop-item" data-item="${it.id}" ${affordable ? '' : 'disabled'}>
              <span class="swatch" style="background:${it.color}"></span>
              <span class="meta">
                <span class="name">${_esc(it.name)}</span>
                <span class="desc">${_esc(desc.join(' · '))}</span>
              </span>
              <span class="price">${it.price} ¥</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  }

  async function render(showShop) {
    const root = document.getElementById(SHELL_ID);
    if (!root) return;
    if (!Store.getCurrentUser()) {
      root.innerHTML = '<p class="test-placeholder">请先登录后开启宠物小窝</p>';
      return;
    }

    const snap = await Pet.snapshot();
    if (!snap) {
      root.innerHTML = '<p class="test-placeholder">加载失败</p>';
      return;
    }

    const shell = _el(`<div class="pet-shell">${_renderStatsCard(snap)}${_renderStage(snap)}${_renderActions()}<div id="pet-shop-host"></div></div>`);
    root.innerHTML = '';
    root.appendChild(shell);

    _bindActions(snap);
    _startDecayTimer();
    _startIdleTimer();
  }

  function _bindActions(snap) {
    const stage = document.getElementById('pet-stage');
    const img = document.getElementById('pet-stage-img');

    // 抚摸（点宠物身体）
    if (img) img.addEventListener('click', async () => {
      img.classList.remove('bounce', 'shake');
      void img.offsetWidth; // 重启动画
      img.classList.add('bounce');
      _spawnParticle(stage, 'pet');
      _nextGif(true);
      const pet = await Pet.pet();
      if (pet && pet.mood >= 100) _showToast('心情满了！');
      setTimeout(() => _nextGif(false), 1400);
    });

    // 4 个动作按钮
    document.querySelectorAll('#page-pet .pet-action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        if (key === 'pet') {
          img.click(); // 复用抚摸
          return;
        }
        // 喂食 / 饮水 / 玩耍 → 默认道具 + 动效
        const map = { feed: 'food_pack', water: 'water_pack', play: 'toy' };
        const itemId = map[key];
        img.classList.remove('bounce', 'shake');
        void img.offsetWidth;
        img.classList.add(key === 'play' ? 'shake' : 'bounce');
        _spawnParticle(stage, key);
        _nextGif(true);
        const r = await Pet.useItem(itemId);
        if (!r.ok) _showToast(r.msg);
        else _showToast(r.msg);
        setTimeout(async () => {
          _nextGif(false);
          await render(false); // 局部重建，更新金币和状态条
          if (r.pet && r.pet.exp === 0 && r.pet.lvl > 1) {
            _showToast('升级了！Lv.' + r.pet.lvl);
          }
        }, 1200);
      });
    });

    // 道具商店入口
    const shopBtn = document.getElementById('pet-shop-open');
    const shopHost = document.getElementById('pet-shop-host');
    if (shopBtn && shopHost) {
      let open = false;
      shopBtn.addEventListener('click', async () => {
        open = !open;
        if (open) {
          const s = await Pet.snapshot();
          shopHost.innerHTML = _renderShop(s);
          _bindShopItems();
          shopBtn.querySelector('span').textContent = '收起商店';
        } else {
          shopHost.innerHTML = '';
          shopBtn.querySelector('span').textContent = '道具商店';
        }
      });
    }
  }

  function _bindShopItems() {
    document.querySelectorAll('#page-pet .pet-shop-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        const itemId = btn.dataset.item;
        const stage = document.getElementById('pet-stage');
        const img = document.getElementById('pet-stage-img');
        const r = await Pet.useItem(itemId);
        if (!r.ok) { _showToast(r.msg); return; }
        _showToast(r.msg);
        // 动效
        const particleKey = { food_pack: 'feed', water_pack: 'water', toy: 'play',
          feast: 'feast', happy_pill: 'happy', exp_drug: 'exp' }[itemId] || 'pet';
        _spawnParticle(stage, particleKey);
        img.classList.remove('bounce', 'shake');
        void img.offsetWidth;
        img.classList.add(particleKey === 'play' ? 'shake' : 'bounce');
        _nextGif(true);
        setTimeout(async () => {
          _nextGif(false);
          // 重新打开商店（刷新金币显示）
          const shopBtn = document.getElementById('pet-shop-open');
          const shopHost = document.getElementById('pet-shop-host');
          if (shopBtn && shopHost && shopHost.innerHTML !== '') {
            const s = await Pet.snapshot();
            shopHost.innerHTML = _renderShop(s);
            _bindShopItems();
          }
          await render(false);
        }, 1200);
      });
    });
  }

  function _startDecayTimer() {
    if (_decayTimer) clearInterval(_decayTimer);
    // 每 30 秒重渲染一次，让衰减可视化
    _decayTimer = setInterval(async () => {
      const shell = document.querySelector('#page-pet .pet-shell');
      if (!shell) return;
      await render(false);
    }, 30 * 1000);
  }

  function _startIdleTimer() {
    if (_idleTimer) clearInterval(_idleTimer);
    _idleTimer = setInterval(() => {
      const img = document.getElementById('pet-stage-img');
      if (!img) return;
      _nextGif(false);
    }, 4 * 1000);
  }

  return { render };
})();

if (typeof window !== 'undefined') window.PetUI = PetUI;