// ============================================================
// 考研学习助手 · AI 请求代理（Cloudflare Worker）
// 部署：在 worker/ 目录执行 `wrangler deploy`
// 作用：浏览器端无法直接请求千问/DeepSeek（CORS），由本 Worker 代为转发。
// 安全：仅做转发，不存储任何 API Key（Key 由前端在请求头里带来）。
// ============================================================

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // 只接受 /api/proxy 的 POST
    if (url.pathname !== '/api/proxy') {
      return new Response('Not Found', { status: 404 });
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }

    const target = payload.url;
    if (!target) return json({ error: '缺少 url 字段' }, 400);

    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(payload.headers || {})
      },
      body: JSON.stringify(payload.body || {})
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders()
      }
    });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
