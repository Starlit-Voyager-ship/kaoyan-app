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

  // 获取今天的日期字符串 YYYY-MM-DD
  today() {
    return new Date().toISOString().slice(0, 10);
  },

  // 获取本周范围
  thisWeek() {
    const now = new Date();
    const day = now.getDay() || 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - day + 1);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().slice(0, 10),
      end: sunday.toISOString().slice(0, 10)
    };
  },

  // 格式化日期显示
  formatDate(dateStr) {
    const d = new Date(dateStr);
    return `${d.getMonth()+1}月${d.getDate()}日`;
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

  // 长图竖向切分：高/宽比过大时切成上下两半，降低单图文字密度，提升 OCR 逐字保真
  // 返回数组（1 张或 2 张 dataURL）。切分失败/比例正常时返回原图。
  cropImageHalves(base64) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.height / Math.max(1, img.width);
        if (ratio < 1.4) { resolve([base64]); return; }
        try {
          const half = Math.floor(img.height / 2);
          const mk = (sy, sh) => {
            const c = document.createElement('canvas');
            c.width = img.width; c.height = sh;
            c.getContext('2d').drawImage(img, 0, sy, img.width, sh, 0, 0, img.width, sh);
            return c.toDataURL('image/jpeg', 0.9);
          };
          resolve([mk(0, half), mk(half, img.height - half)]);
        } catch (_) {
          resolve([base64]);
        }
      };
      img.onerror = () => resolve([base64]);
      img.src = base64;
    });
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
