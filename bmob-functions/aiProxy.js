/*
 * Bmob 云函数：aiProxy（AI 请求代理，绕开浏览器 CORS）
 * ------------------------------------------------------------
 * 部署位置：Bmob 控制台 → 云函数 → 新建函数，函数名填 aiProxy，粘贴本文件全部内容并保存。
 * 作用：浏览器端无法直接请求 DeepSeek / 千问（CORS），由本云函数代为转发。
 * 安全：仅做转发，不存储任何 API Key（Key 由前端在请求头里带来）。
 *
 * 环境说明（实测）：
 *   - modules.oHttp 即 request 库（有 .post/.get），用 oHttp.post(url, opts, cb) 转发
 *   - response 为 Node HTTP 风格，用 writeHead + end 返回
 *   - Node 16，无全局 fetch / 无 oRequest
 *
 * 前端调用：POST https://api.bmobcloud.com/1/functions/aiProxy
 *   请求头：X-Bmob-Application-Id / X-Bmob-REST-API-Key（Bmob.request 自动带）
 *   请求体：{ "url": "https://api.deepseek.com/chat/completions", "headers": {...}, "body": {...} }
 *   返回：   { "status": 200, "body": "<上游响应文本>", "contentType": "application/json" }
 *
 * 注意：Bmob 云函数有执行时长上限，超长/流式响应可能超时；非流式短问答一般没问题。
 */

function onRequest(request, response, modules) {
  var body = request.body || {};
  var target = body.url;
  var headers = body.headers || {};
  var payload = body.body || {};

  // 返回助手：Node HTTP 风格 response（writeHead + end）
  function finish(statusCode, bodyStr, contentType) {
    response.writeHead(statusCode, { 'Content-Type': contentType || 'application/json' });
    response.end(bodyStr);
  }

  if (!target) {
    finish(400, JSON.stringify({ error: 'missing url' }), 'application/json');
    return;
  }

  // 清洗请求头：剔除浏览器/传输层伪头，避免上游拒绝
  var forwardHeaders = {};
  Object.keys(headers).forEach(function (k) {
    var lk = String(k).toLowerCase();
    if (['host', 'content-length', 'connection', 'accept-encoding', 'origin', 'referer'].indexOf(lk) !== -1) return;
    forwardHeaders[k] = headers[k];
  });
  forwardHeaders['Content-Type'] = 'application/json';

  var jsonBody = (typeof payload === 'string') ? payload : JSON.stringify(payload);

  // Bmob oHttp 规范位置参数签名：(url, method, headers, body, callback)
  modules.oHttp(target, 'POST', forwardHeaders, jsonBody, function (err, res, resBody) {
    if (err) {
      finish(502, JSON.stringify({ error: 'aiProxy upstream error: ' + String(err) }), 'application/json');
      return;
    }
    var statusCode = (res && (res.statusCode || res.status)) ? (res.statusCode || res.status) : 502;
    var ct = (res && res.headers && res.headers['content-type']) || 'application/json';
    finish(statusCode, resBody != null ? resBody : '', ct);
  });
}
