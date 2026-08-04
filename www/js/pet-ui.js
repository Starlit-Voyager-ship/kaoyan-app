/* ========================================
   桌面宠物 + 浮层面板
   - 宠物：fixed position 永远在 body 顶层
   - 可拖拽、可漫游、点击开 panel
   - 头顶状态气泡（饿/渴/伤心/严重）
   - 面板：modal，移动端底部 sheet / 桌面居中
   - 取消"宠物小窝"页面：所有页面共用全局蓝天背景
   ======================================== */

const PetUI = (() => {
  // ---- 资源 ----
  const PET_GIFS = [
    './assets/pet/ameath_idle1.gif',
    './assets/pet/ameath_idle2.gif',
    './assets/pet/ameath_idle3.gif',
    './assets/pet/ameath_idle4.gif',
    './assets/pet/ameath_main.gif'
  ];
  const PET_SIZE = 96;        // px (mobile)
  const POS_KEY = 'pet_pos_v1';
  const GIF_INTERVAL = 5000;
  const WANDER_MIN = 9000;
  const WANDER_MAX = 16000;
  const WANDER_STEP_MIN = 30;
  const WANDER_STEP_MAX = 80;
  const DRAG_QUIET_MS = 5000;     // 用户拖动/点击后 N 毫秒不漫游
  const Z_PET = 9998;
  const Z_PANEL = 10010;
  const BOTTOM_RESERVED = 96;     // 底部 tab 区域，让宠物不挡

  // ---- state ----
  let _elPet = null, _elImg = null, _elBubble = null;
  let _elPanel = null, _elPanelBody = null;
  let _gifIdx = 0;
  let _gifTimer = null, _wanderTimer = null, _decayTimer = null, _moodTimer = null;
  let _x = 0, _y = 0;
  let _dragging = false;
  let _dragMoved = false;
  let _pressX = 0, _pressY = 0, _startX = 0, _startY = 0;
  let _lastInteract = 0;
  let _mounted = false;

  // ---- DOM helpers ----
  function _el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _showToast(msg) {
    const t = _el(`<div class="pet-toast">${_esc(msg)}</div>`);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1500);
  }
  function _bar(key, label, value) {
    return `<div class="stat-bar">
      <span class="lbl">${label}</span>
      <div class="stat-track"><div class="stat-fill ${key}" style="width:${Math.round(value)}%"></div></div>
      <span class="num">${Math.round(value)}</span>
    </div>`;
  }
  function _particleIcon(key) {
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
  function _spawnParticleNearPet(key) {
    if (!_elPet) return;
    const p = _el(`<div class="pet-particle">${_particleIcon(key)}</div>`);
    const rect = _elPet.getBoundingClientRect();
    p.style.left = (rect.width / 2 - 16 + (Math.random() * 60 - 30)) + 'px';
    p.style.top = '-20px';
    _elPet.appendChild(p);
    setTimeout(() => p.remove(), 1300);
  }

  // ---- position ----
  function _loadPos() {
    try {
      const raw = localStorage.getItem(POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.x === 'number' && typeof p.y === 'number') return p;
      }
    } catch (e) {}
    return null;
  }
  function _savePos() {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ x: _x, y: _y })); } catch (e) {}
  }
  function _applyPos() {
    if (!_elPet) return;
    const w = window.innerWidth, h = window.innerHeight;
    const size = _elPet.offsetWidth || PET_SIZE;
    // 边界：左右各留 8px，底部让出底部 tab + 一点余量
    _x = Math.max(8, Math.min(w - size - 8, _x));
    _y = Math.max(8, Math.min(h - size - BOTTOM_RESERVED, _y));
    _elPet.style.left = _x + 'px';
    _elPet.style.top = _y + 'px';
  }
  function _defaultPos() {
    const w = window.innerWidth, h = window.innerHeight;
    return { x: w - PET_SIZE - 20, y: h - PET_SIZE - BOTTOM_RESERVED - 20 };
  }

  // ---- GIF cycle ----
  function _setGif(forceMain) {
    if (!_elImg) return;
    if (forceMain) {
      _elImg.src = PET_GIFS[4] + '?t=' + Date.now();
      return;
    }
    _gifIdx = (_gifIdx + 1 + Math.floor(Math.random() * 3)) % 4;
    _elImg.src = PET_GIFS[_gifIdx] + '?t=' + Date.now();
  }
  function _startGifTimer() {
    if (_gifTimer) clearInterval(_gifTimer);
    _gifTimer = setInterval(() => _setGif(false), GIF_INTERVAL);
  }

  // ---- wander ----
  function _scheduleWander() {
    if (_wanderTimer) clearTimeout(_wanderTimer);
    const delay = WANDER_MIN + Math.random() * (WANDER_MAX - WANDER_MIN);
    _wanderTimer = setTimeout(() => {
      if (Date.now() - _lastInteract < DRAG_QUIET_MS) {
        _scheduleWander();
        return;
      }
      _wander();
      _scheduleWander();
    }, delay);
  }
  function _wander() {
    if (!_elPet || _dragging) return;
    const step = WANDER_STEP_MIN + Math.random() * (WANDER_STEP_MAX - WANDER_STEP_MIN);
    const angle = Math.random() * Math.PI * 2;
    _x += Math.cos(angle) * step;
    _y += Math.sin(angle) * step;
    // 移动动画
    _elPet.style.transition = 'left 4s ease, top 4s ease';
    _applyPos();
    _savePos();
    // 动画结束后清掉 transition，避免影响拖拽手感
    setTimeout(() => {
      if (_elPet) _elPet.style.transition = '';
    }, 4100);
  }

  // ---- mood bubble ----
  function _updateMoodBubble(snap) {
    if (!_elBubble || !snap) return;
    const { pet, state } = snap;
    let icon = null;
    if (state.key === 'critical') {
      icon = { color: '#E05050', text: '!' };
    } else if (pet.thirst < 40) {
      icon = { color: '#4F9CD0', text: '渴' };
    } else if (pet.hunger < 40) {
      icon = { color: '#E0914E', text: '饿' };
    } else if (pet.mood < 40) {
      icon = { color: '#9CA3AF', text: '…' };
    }
    if (icon) {
      _elBubble.style.display = 'flex';
      _elBubble.style.background = icon.color;
      _elBubble.textContent = icon.text;
    } else {
      _elBubble.style.display = 'none';
    }
  }
  function _startMoodTimer() {
    if (_moodTimer) clearInterval(_moodTimer);
    _moodTimer = setInterval(async () => {
      try {
        const snap = await Pet.snapshot();
        _updateMoodBubble(snap);
      } catch (e) {}
    }, 10 * 1000);
    // 立即跑一次
    Pet.snapshot().then(_updateMoodBubble).catch(() => {});
  }

  // ---- drag (touch + mouse) ----
  function _bindDrag() {
    if (!_elPet) return;
    const onDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      _dragging = true;
      _dragMoved = false;
      _pressX = pt.clientX;
      _pressY = pt.clientY;
      _startX = _x;
      _startY = _y;
      _elPet.style.transition = 'none';
      _elPet.style.cursor = 'grabbing';
      _lastInteract = Date.now();
      if (e.cancelable) e.preventDefault();
    };
    const onMove = (e) => {
      if (!_dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - _pressX;
      const dy = pt.clientY - _pressY;
      if (!_dragMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _dragMoved = true;
      if (_dragMoved) {
        _x = _startX + dx;
        _y = _startY + dy;
        _applyPos();
      }
      if (e.cancelable) e.preventDefault();
    };
    const onUp = () => {
      if (!_dragging) return;
      _dragging = false;
      _elPet.style.cursor = 'grab';
      _savePos();
      if (!_dragMoved) {
        // 轻点：开 panel
        openPanel();
      } else {
        _lastInteract = Date.now();
      }
    };
    _elPet.addEventListener('mousedown', onDown);
    _elPet.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    window.addEventListener('resize', _applyPos);
  }

  // ---- panel ----
  function _renderPanelContent(snap) {
    const { pet, state, coins, expToNext } = snap;
    const pct = (pet.exp / expToNext) * 100;
    const tagCls = state.key;
    const actions = [
      { key: 'feed',  label: '喂食', icon: '<path d="M5 12c-1-3 1-5 4-5s5 1 6 4 0 5-3 6-6-1-7-5z"/>' },
      { key: 'water', label: '饮水', icon: '<path d="M12 4c2 3 4 6 4 9a4 4 0 1 1-8 0c0-3 2-6 4-9z"/>' },
      { key: 'play',  label: '玩耍', icon: '<circle cx="12" cy="12" r="3.5"/><path d="M12 4v3M12 17v3M4 12h3M17 12h3"/>' },
      { key: 'pet',   label: '抚摸', icon: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.7A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>' }
    ];
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
      <div class="pet-actions">
        ${actions.map(b => `
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
      <div id="pet-shop-host"></div>
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
  function _bindPanelActions() {
    _elPanelBody.querySelectorAll('.pet-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (key === 'pet') { _actPet(); return; }
        const map = { feed: 'food_pack', water: 'water_pack', play: 'toy' };
        _actUseItem(map[key], key);
      });
    });
    const shopBtn = _elPanelBody.querySelector('#pet-shop-open');
    const shopHost = _elPanelBody.querySelector('#pet-shop-host');
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
    _elPanelBody.querySelectorAll('.pet-shop-item').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        _actUseItem(btn.dataset.item, null);
      });
    });
  }
  async function _actPet() {
    if (!_elImg) return;
    _elImg.classList.remove('bounce', 'shake');
    void _elImg.offsetWidth;
    _elImg.classList.add('bounce');
    _spawnParticleNearPet('pet');
    _setGif(true);
    const pet = await Pet.pet();
    if (pet && pet.mood >= 100) _showToast('心情满了！');
    setTimeout(() => _setGif(false), 1400);
  }
  async function _actUseItem(itemId, actionKey) {
    if (!_elImg) return;
    _elImg.classList.remove('bounce', 'shake');
    void _elImg.offsetWidth;
    const isPlay = itemId === 'toy' || actionKey === 'play';
    _elImg.classList.add(isPlay ? 'shake' : 'bounce');
    if (actionKey) _spawnParticleNearPet(actionKey);
    else {
      const particleKey = { food_pack: 'feed', water_pack: 'water', toy: 'play',
        feast: 'feast', happy_pill: 'happy', exp_drug: 'exp' }[itemId] || 'pet';
      _spawnParticleNearPet(particleKey);
    }
    _setGif(true);
    const r = await Pet.useItem(itemId);
    if (!r.ok) _showToast(r.msg);
    else _showToast(r.msg);
    setTimeout(async () => {
      _setGif(false);
      const snap = await Pet.snapshot();
      if (snap) {
        _elPanelBody.innerHTML = _renderPanelContent(snap);
        _bindPanelActions();
        _updateMoodBubble(snap);
      }
      if (r.pet && r.pet.exp === 0 && r.pet.lvl > 1) {
        _showToast('升级了！Lv.' + r.pet.lvl);
      }
    }, 1200);
  }
  async function openPanel() {
    if (!_elPanel) _buildPanel();
    if (!Store.getCurrentUser()) {
      _showToast('请先登录后开启宠物小窝');
      return;
    }
    const snap = await Pet.snapshot();
    if (!snap) { _showToast('加载失败'); return; }
    _elPanelBody.innerHTML = _renderPanelContent(snap);
    _bindPanelActions();
    _elPanel.classList.add('open');
    _updateMoodBubble(snap);
  }
  function closePanel() {
    if (_elPanel) _elPanel.classList.remove('open');
  }
  let _escHandler = null;
  function _buildPanel() {
    _elPanel = _el(`<div class="pet-panel" id="pet-panel">
      <div class="pet-panel-mask"></div>
      <div class="pet-panel-sheet">
        <div class="pet-panel-handle"></div>
        <div class="pet-panel-title">
          <span>宠物小窝</span>
          <button class="pet-panel-close" aria-label="关闭">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
        </div>
        <div class="pet-panel-body" id="pet-panel-body"></div>
      </div>
    </div>`);
    document.body.appendChild(_elPanel);
    _elPanelBody = _elPanel.querySelector('#pet-panel-body');
    const closeBtn = _elPanel.querySelector('.pet-panel-close');
    const mask = _elPanel.querySelector('.pet-panel-mask');
    const sheet = _elPanel.querySelector('.pet-panel-sheet');
    // 关闭按钮：click + touchend 双保险
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closePanel(); });
    closeBtn.addEventListener('touchend', (e) => { e.stopPropagation(); e.preventDefault(); closePanel(); });
    mask.addEventListener('click', closePanel);
    // 下滑手势关闭（仅 sheet 顶部 90px 区域触发）
    let dStartY = 0, dStartX = 0, dDelta = 0, dDragging = false;
    sheet.addEventListener('touchstart', (e) => {
      const rect = sheet.getBoundingClientRect();
      if (e.touches[0].clientY - rect.top < 90) {
        dStartY = e.touches[0].clientY; dStartX = e.touches[0].clientX;
        dDelta = 0; dDragging = true; sheet.style.transition = 'none';
      }
    }, { passive: true });
    sheet.addEventListener('touchmove', (e) => {
      if (!dDragging) return;
      const dy = e.touches[0].clientY - dStartY;
      const dx = Math.abs(e.touches[0].clientX - dStartX);
      if (dy > 0 && dy > dx * 1.5) {
        dDelta = dy;
        sheet.style.transform = `translateY(${dy}px)`;
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
    sheet.addEventListener('touchend', () => {
      if (!dDragging) return;
      dDragging = false; sheet.style.transition = '';
      if (dDelta > 80) closePanel(); else sheet.style.transform = '';
      dDelta = 0;
    });
    // ESC / Android 硬件返回键关闭
    _escHandler = (e) => {
      if (!_elPanel || !_elPanel.classList.contains('open')) return;
      if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'Back') closePanel();
    };
    document.addEventListener('keydown', _escHandler);
  }

  // ---- mount ----
  function mount() {
    if (_mounted) return;
    _elPet = _el(`<div class="desktop-pet" id="desktop-pet">
      <div class="pet-mood-bubble" id="pet-mood-bubble"></div>
      <img class="desktop-pet-img" id="desktop-pet-img" src="${PET_GIFS[4]}" alt="宠物" draggable="false">
    </div>`);
    document.body.appendChild(_elPet);
    _elImg = _elPet.querySelector('#desktop-pet-img');
    _elBubble = _elPet.querySelector('#pet-mood-bubble');
    _elPet.style.zIndex = Z_PET;
    _elPet.style.cursor = 'grab';

    const saved = _loadPos();
    if (saved) {
      _x = saved.x; _y = saved.y;
    } else {
      const p = _defaultPos();
      _x = p.x; _y = p.y;
    }
    _applyPos();

    _bindDrag();
    _startGifTimer();
    _scheduleWander();
    _startMoodTimer();
    _mounted = true;
  }

  return {
    mount,
    openPanel,
    closePanel
  };
})();

if (typeof window !== 'undefined') window.PetUI = PetUI;
