/* ========================================
   倒数日模块
   - 用户在首页设置目标日期 + 命名
   - 实时计算距离目标还有多少天
   - 数据存云端（Store.put 'countdown'），换设备同步
   ======================================== */

const Countdown = (() => {
  const STORE = 'countdown';
  const ID = 'countdown_target';

  // 计算距离今天还有多少天
  // 返回 { days, isPast, isToday }
  function diff(targetDateStr) {
    if (!targetDateStr) return { days: null, isPast: false, isToday: false };
    const target = new Date(targetDateStr + 'T00:00:00');
    if (isNaN(target.getTime())) return { days: null, isPast: false, isToday: false };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffMs = target.getTime() - today.getTime();
    const days = Math.round(diffMs / 86400000);
    return {
      days,
      isPast: days < 0,
      isToday: days === 0
    };
  }

  // 读取已保存的目标
  async function load() {
    const rec = await Store.get(STORE, ID);
    return rec || null;
  }

  // 保存目标
  async function save(name, date) {
    const user = Store.getCurrentUser();
    if (!user) return;
    await Store.put(STORE, { id: ID, name: name || '目标日', date });
  }

  // 清掉目标
  async function clear() {
    const user = Store.getCurrentUser();
    if (!user) return;
    await Store.delete(STORE, ID);
  }

  // 渲染首页 Hero（巨号天数 + 考研旅程进度条）
  async function renderHome() {
    const card = document.getElementById('home-countdown-card');
    if (!card) return;
    if (!Store.getCurrentUser()) { card.style.display = 'none'; return; }
    card.style.display = '';

    const rec = await load();
    const nameEl = document.getElementById('home-countdown-name');
    const subEl  = document.getElementById('home-countdown-sub');
    const numEl  = document.getElementById('home-countdown-num');
    const barEl  = document.getElementById('home-countdown-progress');

    if (!rec || !rec.date) {
      nameEl.textContent = '未设置目标日';
      subEl.textContent = '点击设置考研 / 考试日期';
      numEl.textContent = '--';
      card.classList.remove('is-past', 'is-today');
      if (barEl) barEl.style.width = '0%';
      return;
    }

    const d = diff(rec.date);
    if (d.days === null) {
      nameEl.textContent = rec.name || '目标日';
      subEl.textContent = '日期无效，点击重新设置';
      numEl.textContent = '--';
      card.classList.remove('is-past', 'is-today');
      if (barEl) barEl.style.width = '0%';
      return;
    }

    nameEl.textContent = rec.name || '距离目标还有';
    card.classList.toggle('is-past', d.isPast);
    card.classList.toggle('is-today', d.isToday);

    if (d.isToday) {
      numEl.textContent = '0';
      subEl.textContent = '就是今天，全力以赴';
      if (barEl) barEl.style.width = '100%';
    } else if (d.isPast) {
      numEl.textContent = Math.abs(d.days);
      subEl.textContent = '已过去 · 点击可修改';
      if (barEl) barEl.style.width = '100%';
    } else {
      numEl.textContent = d.days;
      const pct = yearProgress(rec.date);
      if (barEl) barEl.style.width = pct + '%';
      subEl.textContent = '已走过 ' + pct + '% · ' + rec.date + '（点击修改）';
    }
  }

  // 考研旅程进度：从目标年 1/1 到目标日，已过去的比例
  function yearProgress(targetDateStr) {
    const target = new Date(targetDateStr + 'T00:00:00');
    const year = target.getFullYear();
    const start = new Date(year, 0, 1).getTime();
    const total = target.getTime() - start;
    if (total <= 0) return 100;
    const elapsed = Date.now() - start;
    return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  }

  // 打开编辑器
  function openEditor(ev) {
    if (ev) ev.stopPropagation();
    if (!Store.getCurrentUser()) { Utils.toast('请先登录'); return; }

    load().then(rec => {
      const curName = rec ? (rec.name || '') : '距离考研还有';
      const curDate = rec ? (rec.date || '') : '';
      const body = `
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:8px">
          <label style="font-size:0.85rem;color:var(--text-secondary)">目标名称</label>
          <input id="cd-name" type="text" maxlength="20" value="${_esc(curName)}"
                 placeholder="如：距离考研还有"
                 style="padding:10px 12px;border:1px solid var(--glass-border);border-radius:10px;font-size:0.95rem;font-family:inherit;background:var(--glass-bg-heavy);color:var(--text)" />
          <label style="font-size:0.85rem;color:var(--text-secondary)">目标日期</label>
          <input id="cd-date" type="date" value="${curDate}"
                 style="padding:10px 12px;border:1px solid var(--glass-border);border-radius:10px;font-size:0.95rem;font-family:inherit;background:var(--glass-bg-heavy);color:var(--text)" />
        </div>`;
      const footer = `
        <button class="btn-danger" id="cd-clear" style="margin-right:auto">清除</button>
        <button class="btn-outline" onclick="Utils.hideModal()">取消</button>
        <button class="btn-primary" id="cd-save">保存</button>`;
      Utils.showModal('设置倒数日', body, footer);

      const saveBtn = document.getElementById('cd-save');
      saveBtn.onclick = async () => {
        const name = document.getElementById('cd-name').value.trim();
        const date = document.getElementById('cd-date').value;
        if (!date) { Utils.toast('请选择日期'); return; }
        if (!name) { Utils.toast('请填写名称'); return; }
        await save(name, date);
        Utils.hideModal();
        await renderHome();
        Utils.toast('已保存');
      };
      const clearBtn = document.getElementById('cd-clear');
      clearBtn.onclick = async () => {
        await clear();
        Utils.hideModal();
        await renderHome();
        Utils.toast('已清除');
      };
    });
  }

  function _esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return { load, save, clear, renderHome, openEditor, diff };
})();

if (typeof window !== 'undefined') {
  window.Countdown = Countdown;
  window.__COUNTDOWN_BUILD__ = '20260804b';
  console.log('[Countdown] build:', window.__COUNTDOWN_BUILD__);
}
