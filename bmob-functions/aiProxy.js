/*
 * Bmob 云函数：aiProxy（AI 请求代理，绕开浏览器 CORS）
 * ------------------------------------------------------------
 * 部署位置：Bmob 控制台 → 云函数 → 新建函数，函数名填 aiProxy，粘贴本文件全部内容并保存。
 * 作用：浏览器端无法直接请求 DeepSeek / 千问（CORS），由本云函数代为转发。
 * 安全：仅做转发，不存储任何 API Key（Key 由前端在请求头里带来）。
 *
 * 前端调用：POST https://api.bmobcloud.com/1/functions/aiProxy
 *   请求头：X-Bmob-Application-Id / X-Bmob-REST-API-Key（Bmob.request 自动带）
 *   请求体：{ "url": "https://api.deepseek.com/chat/completions", "headers": {...}, "body": {...} }
 *   返回：   { "result": { "status": 200, "body": "<上游响应文本>", "contentType": "application/json" } }
 *
 * 注意：Bmob 云函数有执行时长上限，超长/流式响应可能超时；非流式短问答一般没问题。
 */

function onRequest(request, response, modules) {
  var body = request.body || {};
  var target = body.url;
  var headers = body.headers || {};
  var payload = body.body || {};

  if (!target) {
    response.success({
      status: 400,
      body: JSON.stringify({ error: 'missing url' }),
      contentType: 'application/json'
    });
    return;
  }

  // 清洗请求头：剔除浏览器/传输层伪头，避免上游拒绝
  var forwardHeaders = {};
  Object.keys(headers).forEach(function (k) {
    var lk = String(k).toLowerCase();
    if (lk === 'host' || lk === 'content-length' || lk === 'connection' ||
        lk === 'accept-encoding' || lk === 'origin' || lk === 'referer') return;
    forwardHeaders[k] = headers[k];
  });
  forwardHeaders['Content-Type'] = 'application/json';

  var oRequest = modules.oRequest;
  oRequest({
    url: target,
    method: 'POST',
    headers: forwardHeaders,
    body: JSON.stringify(payload)
  }, function (err, res, resBody) {
    if (err) {
      response.success({
        status: 502,
        body: JSON.stringify({ error: 'aiProxy upstream error: ' + String(err) }),
        contentType: 'application/json'
      });
      return;
    }
    // 即便上游返回非 2xx，也原样透传状态码与响应体，让前端按真实错误提示
    response.success({
      status: res.statusCode,
      body: resBody != null ? resBody : '',
      contentType: (res.headers && res.headers['content-type']) || 'application/json'
    });
  });
}
