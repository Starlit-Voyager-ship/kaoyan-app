/* ========================================
   自定义 UI 控件（替换 Android WebView 原生日期/下拉）
   ========================================
   - DatePicker: 自定义日期选择弹层（替代 <input type="date">）
     使用：<button data-date-pill data-target="hidden-id">2026/08/05</button>
           <input type="hidden" id="hidden-id" value="2026-08-05">
     点击按钮 → 弹层 → 选日期 → 同步更新按钮文字 + 隐藏 input + 派发 change
   - Select: 镜像 <select> 的自定义下拉
     使用：<select data-custom-select>...</select>
     保留 <select> 在 DOM 但隐藏，外部 JS 仍可读 .value
*/

const Widgets = {
  /* =====================================================
     Date Picker
     ===================================================== */
  _dpOverlay: null,

  _ensureDpOverlay() {
    if (this._dpOverlay && document.body.contains(this._dpOverlay)) return this._dpOverlay;
    let ov = document.getElementById('dp-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'dp-overlay';
      ov.className = 'dp-overlay';
      ov.style.display = 'none';
      ov.innerHTML = `
        <div class="dp-modal" role="dialog" aria-label="选择日期">
          <div class="dp-head">
            <button class="dp-nav-btn dp-year-prev" aria-label="上一年">«</button>
            <button class="dp-nav-btn dp-month-prev" aria-label="上一月">‹</button>
            <div class="dp-title" data-role="title"></div>
            <button class="dp-nav-btn dp-month-next" aria-label="下一月">›</button>
            <button class="dp-nav-btn dp-year-next" aria-label="下一年">»</button>
          </div>
          <div class="dp-weekdays"></div>
          <div class="dp-grid"></div>
          <div class="dp-foot">
            <button class="dp-link dp-today">今天</button>
            <button class="dp-link dp-clear">清除</button>
            <button class="dp-btn dp-cancel">取消</button>
            <button class="dp-btn dp-confirm primary">确定</button>
          </div>
        </div>`;
      document.body.appendChild(ov);
      // 背景点击关闭
      ov.addEventListener('click', e => {
        if (e.target === ov) this.closeDatePicker();
      });
    }
    this._dpOverlay = ov;
    return ov;
  },

  // 把中文数字星期格式化
  _weekdayLabels: ['一', '二', '三', '四', '五', '六', '日'],

  _pad2(n) { return String(n).padStart(2, '0'); },

  // 把 YYYY-MM-DD 拆成 {y, m, d}
  _parseISO(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  },

  _toISO(y, m, d) { return `${y}-${this._pad2(m + 1)}-${this._pad2(d)}`; },

  // 渲染月历
  _renderMonth(state) {
    const ov = this._dpOverlay;
    const title = ov.querySelector('[data-role="title"]');
    title.textContent = `${state.viewY} 年 ${state.viewM + 1} 月`;

    const wdEl = ov.querySelector('.dp-weekdays');
    wdEl.innerHTML = this._weekdayLabels.map(w => `<div class="dp-wd">${w}</div>`).join('');

    const grid = ov.querySelector('.dp-grid');
    grid.innerHTML = '';

    // 当月第一天是星期几（周一=0）
    const first = new Date(state.viewY, state.viewM, 1);
    const firstWeekday = (first.getDay() + 6) % 7;
    // 当月天数
    const daysInMonth = new Date(state.viewY, state.viewM + 1, 0).getDate();
    const todayISO = Utils.today();
    const selISO = state.selected ? this._toISO(state.selected.y, state.selected.m, state.selected.d) : null;

    // 前置空格
    for (let i = 0; i < firstWeekday; i++) {
      const e = document.createElement('div');
      e.className = 'dp-cell empty';
      grid.appendChild(e);
    }
    // 日期格
    for (let d = 1; d <= daysInMonth; d++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'dp-cell';
      const iso = this._toISO(state.viewY, state.viewM, d);
      cell.textContent = d;
      cell.dataset.iso = iso;
      if (iso === todayISO) cell.classList.add('today');
      if (iso === selISO) cell.classList.add('selected');
      grid.appendChild(cell);
    }
  },

  openDatePicker(opts) {
    const { initial, onSelect, onClear, minYear, maxYear, title } = opts;
    const ov = this._ensureDpOverlay();
    ov.style.display = 'flex';
    ov.querySelector('.dp-title').textContent = title || '选择日期';

    // 状态
    const parsed = this._parseISO(initial);
    const today = new Date();
    const state = {
      viewY: parsed ? parsed.y : today.getFullYear(),
      viewM: parsed ? parsed.m : today.getMonth(),
      selected: parsed || null,
      minYear: minYear || 2000,
      maxYear: maxYear || today.getFullYear() + 5,
      onSelect, onClear
    };
    this._dpState = state;

    this._renderMonth(state);

    // 一次性绑定（防止重复挂）
    if (!ov.dataset.bound) {
      ov.dataset.bound = '1';
      ov.querySelector('.dp-year-prev').addEventListener('click', () => {
        const s = this._dpState;
        if (s.viewY > s.minYear) { s.viewY--; this._renderMonth(s); }
      });
      ov.querySelector('.dp-year-next').addEventListener('click', () => {
        const s = this._dpState;
        if (s.viewY < s.maxYear) { s.viewY++; this._renderMonth(s); }
      });
      ov.querySelector('.dp-month-prev').addEventListener('click', () => {
        const s = this._dpState;
        if (s.viewM === 0) {
          if (s.viewY > s.minYear) { s.viewY--; s.viewM = 11; }
        } else { s.viewM--; }
        this._renderMonth(s);
      });
      ov.querySelector('.dp-month-next').addEventListener('click', () => {
        const s = this._dpState;
        if (s.viewM === 11) {
          if (s.viewY < s.maxYear) { s.viewY++; s.viewM = 0; }
        } else { s.viewM++; }
        this._renderMonth(s);
      });
      // 选日
      ov.querySelector('.dp-grid').addEventListener('click', e => {
        const cell = e.target.closest('.dp-cell');
        if (!cell || cell.classList.contains('empty')) return;
        const iso = cell.dataset.iso;
        const p = this._parseISO(iso);
        const s = this._dpState;
        s.selected = p;
        this._renderMonth(s);
      });
      // 今天/清除/取消/确定
      ov.querySelector('.dp-today').addEventListener('click', () => {
        const t = new Date();
        const s = this._dpState;
        s.viewY = t.getFullYear(); s.viewM = t.getMonth();
        s.selected = { y: t.getFullYear(), m: t.getMonth(), d: t.getDate() };
        this._renderMonth(s);
      });
      ov.querySelector('.dp-clear').addEventListener('click', () => {
        if (state.onClear) state.onClear();
        this.closeDatePicker();
      });
      ov.querySelector('.dp-cancel').addEventListener('click', () => this.closeDatePicker());
      ov.querySelector('.dp-confirm').addEventListener('click', () => {
        const s = this._dpState;
        if (!s.selected) { Utils.toast('请先选一个日期'); return; }
        const iso = this._toISO(s.selected.y, s.selected.m, s.selected.d);
        if (s.onSelect) s.onSelect(iso);
        this.closeDatePicker();
      });
    }
  },

  closeDatePicker() {
    if (this._dpOverlay) this._dpOverlay.style.display = 'none';
  },

  // 把 YYYY-MM-DD 转 YYYY/MM/DD 等
  formatDate(iso, fmt) {
    const p = this._parseISO(iso);
    if (!p) return '';
    const yyyy = p.y;
    const MM = this._pad2(p.m + 1);
    const dd = this._pad2(p.d);
    switch (fmt) {
      case 'YYYY-MM-DD': return `${yyyy}-${MM}-${dd}`;
      case 'MM-DD': return `${MM}-${dd}`;
      case 'M月D日': return `${p.m + 1}月${p.d}日`;
      default: return `${yyyy}/${MM}/${dd}`;
    }
  },

  /* =====================================================
     Custom Select
     ===================================================== */
  upgradeSelects(root) {
    (root || document).querySelectorAll('select[data-custom-select]').forEach(sel => {
      if (sel.dataset.upgraded === '1') return;
      sel.dataset.upgraded = '1';
      this._wrapSelect(sel);
    });
  },

  _wrapSelect(sel) {
    // 已有 wrapper 则跳过
    if (sel.parentElement?.classList.contains('custom-select-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'custom-select-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'custom-select-btn';
    btn.setAttribute('aria-haspopup', 'listbox');

    const refresh = () => {
      const opt = sel.selectedOptions[0];
      const label = opt ? opt.textContent : '';
      const placeholder = sel.dataset.placeholder || '';
      const empty = !opt || opt.value === '';
      btn.innerHTML = `
        <span class="cs-text ${empty ? 'placeholder' : ''}">${Utils._escapeHtml(label || placeholder || '请选择')}</span>
        <svg class="ico cs-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
    };
    refresh();

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      this._openSelectMenu(sel, btn, refresh);
    });

    // 隐藏原生 select 但保留在 DOM
    sel.classList.add('cs-hidden');
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.appendChild(btn);

    // 监听 select 变化（如外部代码修改 .value）→ 刷新 UI
    sel.addEventListener('change', refresh);

    // 监听 <option> 列表变化（动态填充）→ 重新刷新按钮文字
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(refresh).observe(sel, { childList: true, subtree: true });
    }
  },

  _openSelectMenu(sel, btn, refresh) {
    // 关闭其他菜单
    document.querySelectorAll('.cs-menu').forEach(m => m.remove());

    const wrap = btn.parentElement;
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'cs-menu';

    const opts = Array.from(sel.options).map((o, i) => {
      const isSel = o.selected;
      return `<button type="button" class="cs-opt ${isSel ? 'selected' : ''}" data-idx="${i}" data-value="${Utils._escapeHtml(o.value)}">
        <span>${Utils._escapeHtml(o.textContent)}</span>
        ${isSel ? '<svg class="ico cs-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>' : ''}
      </button>`;
    }).join('');
    menu.innerHTML = opts || '<div class="cs-empty">无选项</div>';

    document.body.appendChild(menu);
    // 定位
    const top = rect.bottom + window.scrollY + 6;
    const left = rect.left + window.scrollX;
    menu.style.position = 'absolute';
    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.style.minWidth = rect.width + 'px';

    // 视口边缘保护
    requestAnimationFrame(() => {
      const mr = menu.getBoundingClientRect();
      if (mr.right > window.innerWidth - 8) {
        menu.style.left = (window.innerWidth - mr.width - 8 + window.scrollX) + 'px';
      }
      if (mr.bottom > window.innerHeight - 8) {
        menu.style.top = (rect.top + window.scrollY - mr.height - 6) + 'px';
      }
    });

    // 选项点击
    menu.addEventListener('click', e => {
      const opt = e.target.closest('.cs-opt');
      if (!opt) return;
      const idx = +opt.dataset.idx;
      sel.selectedIndex = idx;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      refresh();
      menu.remove();
    });

    // 外部点击关闭
    setTimeout(() => {
      document.addEventListener('click', function _h(ev) {
        if (menu.contains(ev.target) || btn.contains(ev.target)) return;
        menu.remove();
        document.removeEventListener('click', _h);
      });
    }, 0);
  },

  /* =====================================================
     初始化：把 [data-date-pill] 按钮和 [data-custom-select] 下拉
     一并接入
     ===================================================== */
  init(root) {
    const r = root || document;
    // 日期 pill
    r.querySelectorAll('[data-date-pill]').forEach(btn => {
      if (btn.dataset.dpBound === '1') return;
      btn.dataset.dpBound = '1';
      btn.addEventListener('click', e => {
        e.preventDefault();
        const targetId = btn.dataset.target;
        const target = targetId ? document.getElementById(targetId) : null;
        const cur = target?.value || Utils.today();
        const fmt = btn.dataset.fmt || 'YYYY/MM/DD';
        this.openDatePicker({
          initial: cur,
          onSelect: (iso) => {
            if (target) {
              target.value = iso;
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const textEl = btn.querySelector('.date-pill-text') || btn;
            textEl.textContent = this.formatDate(iso, fmt);
          },
          onClear: () => {
            if (target) {
              target.value = '';
              target.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const textEl = btn.querySelector('.date-pill-text') || btn;
            textEl.textContent = btn.dataset.placeholder || '选择日期';
          }
        });
      });
    });
    // 下拉
    this.upgradeSelects(r);
  }
};