// ============================================================
// 部署配置（浏览器端 AI 代理地址）
// ------------------------------------------------------------
// 本地调试：保持 '/api/proxy'（由项目根目录 serve.py 提供）
// 公网部署（GitHub Pages + Cloudflare Worker）：把下面的值改成你的 Worker 地址，
//   例如：window.APP_CONFIG = { proxyUrl: 'https://kaoyan-ai-proxy.xxx.workers.dev/api/proxy' };
// 注意：部署到 GitHub Pages 之前务必改成绝对地址，否则网页端的 AI 功能无法使用。
// 代理只转发请求、不存储任何 API Key（Key 由前端在请求头里带来）。
// ============================================================
window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.proxyUrl = window.APP_CONFIG.proxyUrl || '/api/proxy';
