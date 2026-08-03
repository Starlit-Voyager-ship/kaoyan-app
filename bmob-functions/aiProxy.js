/*
 * Bmob 云函数：aiProxy（AI 请求代理，绕开浏览器 CORS）
 * ------------------------------------------------------------
 * 部署位置：Bmob 控制台 → 云函数 → 新建函数，函数名填 aiProxy，粘贴本文件全部内容并保存。
 * 作用：浏览器端无法直接请求 DeepSeek / 千问（CORS），由本云函数代为转发。
 * 安全：仅做转发，不存储任何 API Key（Key 由前端在请求头里带来）。
 *
 * 环境：Node 16，模块含 oHttp / oLibHttp（无 oRequest、无全局 fetch）；
 *       response 为 Node HTTP 风格，用 writeHead + end 返回。
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
    try {
      if (typeof response.writeHead === 'function') {
        response.writeHead(statusCode, { 'Content-Type': contentType || 'application/json' });
      }
      if (typeof response.end === 'function') {
        response.end(bodyStr);
      } else if (typeof response.write === 'function') {
        response.write(bodyStr);
        response.end();
      } else {
        return bodyStr; // 极端兜底
      }
    } catch (e) {
      return bodyStr;
    }
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

  // 探测 HTTP 模块的实际结构（Bmob 模块可能是对象而非函数）
  var _diag = {};
  ['oLibHttp', 'oHttp'].forEach(function(k) {
    if (!modules || !modules[k]) { _diag[k] = 'missing'; return; }
    var m = modules[k];
    _diag[k] = { type: typeof m, keys: Object.keys(m).filter(function(x){return typeof m[x]==='function';}) };
  });

  // 尝试多种调用方式
  function tryCall(name, fn) {
    try { fn(); return true; } catch(e) { _diag[name+'_err'] = String(e.message||e); return false; }
  }

  // 方式 A: oLibHttp 作为函数直接调用 (options, cb)
  // 方式 B: oLibHttp.request(options, cb)
  // 方式 C: oHttp 作为函数直接调用 (url, method, headers, body, cb)
  // 方式 D: oHttp.get/post(url, options, cb)
  var called = false;

  function doCall(httpFnOrObj, style) {
    if (called) return;
    if (style === 'libAsFunc' && typeof httpFnOrObj === 'function') {
      called = true;
      httpFnOrObj({ url: target, method: 'POST', headers: forwardHeaders, body: jsonBody }, cb);
    } else if (style === 'libRequest' && httpFnOrObj && typeof httpFnOrObj.request === 'function') {
      called = true;
      httpFnOrObj.request({ url: target, method: 'POST', headers: forwardHeaders, body: jsonBody }, cb);
    } else if (style === 'httpAsFunc' && typeof httpFnOrObj === 'function') {
      called = true;
      httpFnOrObj(target, 'POST', forwardHeaders, jsonBody, cb);
    } else if (style === 'httpPost' && httpFnOrObj && typeof httpFnOrObj.post === 'function') {
      called = true;
      httpFnOrObj.post(target, { headers: forwardHeaders, body: jsonBody }, cb);
    }
  }

  if (modules && modules.oLibHttp) {
    doCall(modules.oLibHttp, 'libAsFunc');
    if (!called) doCall(modules.oLibHttp, 'libRequest');
  }
  if (!called && modules && modules.oHttp) {
    doCall(modules.oHttp, 'httpAsFunc');
    if (!called) doCall(modules.oHttp, 'httpPost');
  }

  if (!called) {
    finish(500, JSON.stringify({ error: 'no usable http method found', diag: _diag }), 'application/json');
    return;
  }

  function cb(err, res, resBody) {
    if (err) {
      finish(502, JSON.stringify({ error: 'aiProxy upstream error: ' + String(err) }), 'application/json');
      return;
    }
    var statusCode = (res && (res.statusCode || res.status)) ? (res.statusCode || res.status) : 502;
    var ct = (res && res.headers && res.headers['content-type']) || 'application/json';
    finish(statusCode, resBody != null ? resBody : '', ct);
  }

}
