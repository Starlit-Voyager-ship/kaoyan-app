/* ========================================
   工具函数
   ======================================== */

const Utils = {
  // Toast提示
  toast(msg, duration = 2000) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.style.display = 'none'; }, duration);
  },

  // Modal弹窗
  showModal(title, body, footer = '') {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = body;
    document.getElementById('modal-footer').innerHTML = footer;
    document.getElementById('modal-overlay').style.display = 'flex';
  },
  hideModal() {
    document.getElementById('modal-overlay').style.display = 'none';
  },

  // 格式化时间 mm:ss
  formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  },

  // 格式化时长 HH:MM:SS
  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  },

  // 获取今天的日期字符串 YYYY-MM-DD（按中国标准时间 UTC+8，避免东八区凌晨取到前一天）
  today() {
    return this.cnDate(new Date());
  },

  // 把任意时间换算成中国标准日期的 YYYY-MM-DD
  cnDate(jsDate) {
    const t = jsDate ? jsDate.getTime() : NaN;
    if (!Number.isFinite(t)) return '';
    const d = new Date(t + 8 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  },

  // 中国日历日期加减（对 YYYY-MM-DD 做纯日历运算，不经过设备时区）
  shiftDate(dateStr, deltaDays) {
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateStr;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    d.setUTCDate(d.getUTCDate() + Number(deltaDays || 0));
    return d.toISOString().slice(0, 10);
  },

  // 获取本周范围（周一起始，按中国日历日期）
  thisWeek() {
    const today = this.today();
    const m = String(today).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return { start: today, end: today };
    const weekday = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay() || 7;
    return {
      start: this.shiftDate(today, 1 - weekday),
      end: this.shiftDate(today, 7 - weekday)
    };
  },

  // 格式化日期显示（按日期字符串本身，不依赖设备时区）
  formatDate(dateStr) {
    const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateStr;
    return `${Number(m[2])}月${Number(m[3])}日`;
  },

  // 生成随机ID
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  },

  // 生成邀请码（6位大写字母数字）
  inviteCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  },

  // 防抖
  debounce(fn, delay = 300) {
    let timer;
    return function(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  // 复制到剪贴板
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      Utils.toast('已复制');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      Utils.toast('已复制');
    }
  },

  // 图片转base64
  imgToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  // 压缩图片
  compressImg(base64, maxWidth = 800, quality = 0.8) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h *= maxWidth / w; w = maxWidth; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = base64;
    });
  },

  // 长图竖向切分：高/宽比过大时按比例切成 N 段，降低单图文字密度，提升 OCR 逐字保真
  // - ratio<1.4: 1 张（横图，不切）
  // - 1.4≤ratio<2.4: 2 段（一般长图，如"文章+题目"一张图）
  // - ratio≥2.4: 3 段（极长图，如整张试卷：上半文章+题+下半文章+题）
  // 返回数组（1/2/3 张 dataURL）。切分失败时返回原图。
  splitLongImage(base64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.height / Math.max(1, img.width);
        if (ratio < 1.4) { resolve([base64]); return; }
        const parts = ratio >= 2.4 ? 3 : 2;
        try {
          const segH = Math.floor(img.height / parts);
          const out = [];
          for (let i = 0; i < parts; i++) {
            const sy = i * segH;
            const sh = (i === parts - 1) ? (img.height - sy) : segH;
            const c = document.createElement('canvas');
            c.width = img.width; c.height = sh;
            c.getContext('2d').drawImage(img, 0, sy, img.width, sh, 0, 0, img.width, sh);
            // 切分段用高画质输出（用户原图清晰度不打折）
            out.push(c.toDataURL('image/jpeg', 0.92));
          }
          resolve(out);
        } catch (_) {
          resolve([base64]);
        }
      };
      img.onerror = () => resolve([base64]);
      img.src = base64;
    });
  },

  // 兼容旧调用（部分早期代码可能引用 cropImageHalves）
  cropImageHalves(base64) {
    return this.splitLongImage(base64);
  },

  // 简单的hash函数（用于密码存储演示）
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + ch;
      hash |= 0;
    }
    return hash.toString(16);
  },

  // HTML 转义（用户输入塞进 innerHTML 时用）
  _escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
};

// Modal关闭事件
document.getElementById('modal-close').addEventListener('click', Utils.hideModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) Utils.hideModal();
});
