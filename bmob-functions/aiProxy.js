// aiProxy 探测版 v6：仅返回 oLibHttp / oHttp 的真实结构，用于确认正确调用方式
function onRequest(request, response, modules) {
  function keysOf(m) {
    if (!m) return 'missing';
    return Object.keys(m).filter(function (k) { return typeof m[k] === 'function'; });
  }
  var info = {
    oLibHttp_type: typeof modules.oLibHttp,
    oLibHttp_funcKeys: keysOf(modules.oLibHttp),
    oHttp_type: typeof modules.oHttp,
    oHttp_funcKeys: keysOf(modules.oHttp)
  };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(info));
}
