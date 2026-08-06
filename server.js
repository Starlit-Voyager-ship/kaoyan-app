/**
 * 考研学习助手 - 轻量后端
 * --------------------------------------------------
 * 已废弃：好友叫醒已改为 Bmob 轮询（WakeBind/WakeMsg），本文件仅作历史参考，无需部署。
 * 职责：
 *   1. 好友邀请码双向绑定（跨设备）
 *   2. 叫醒信号实时推送（WebSocket）
 *   3. 账号数据同步骨架（多端互通）
 *
 * 运行：  node server.js        （PORT 默认 3001）
 * 依赖：  ws   →  npm i ws
 *
 * 说明：小范围 5 人自用，采用进程内内存存储（重启清空即可）。
 *       若需持久化，可把 devices/codes/syncData 换成 Redis 或写文件。
 *       部署到公网时务必用 wss（TLS）+ 反向代理（如 Nginx/Caddy）。
 * --------------------------------------------------
 */
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3001;

/* ---------- 内存存储 ---------- */
const devices  = new Map();  // deviceId -> { ws, user, peer, alive }
const codes    = new Map();  // inviteCode -> deviceId
const syncData = new Map();  // deviceId  -> 最近一次同步数据包

function genCode() {
  let c;
  do { c = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6); }
  while (codes.has(c));
  return c;
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}
function rid() { return crypto.randomBytes(8).toString('hex'); }

/* ---------- HTTP（健康检查/状态） ---------- */
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, devices: devices.size, codes: codes.size }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('考研学习助手 WebSocket 后端运行中。客户端请连接 /ws 端点。');
});

/* ---------- WebSocket ---------- */
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let myId = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      /* 客户端上线：携带 deviceId（可复用上次）与用户名 */
      case 'hello': {
        myId = msg.deviceId || rid();
        const rec = devices.get(myId) || {};
        rec.ws = ws;
        rec.user = msg.user || rec.user || null;
        rec.peer = rec.peer || null;
        rec.alive = true;
        devices.set(myId, rec);
        send(ws, { type: 'welcome', deviceId: myId });
        break;
      }

      /* 生成邀请码（5 分钟有效） */
      case 'createCode': {
        if (!myId) return send(ws, { type: 'err', reason: '未连接' });
        const code = genCode();
        codes.set(code, myId);
        setTimeout(() => { if (codes.get(code) === myId) codes.delete(code); }, 5 * 60 * 1000);
        send(ws, { type: 'codeCreated', code });
        break;
      }

      /* 用邀请码绑定对方（双向） */
      case 'bind': {
        if (!myId) return;
        const target = codes.get(msg.code);
        if (!target || target === myId)
          return send(ws, { type: 'bindResult', ok: false, reason: '邀请码无效或已过期' });
        const a = devices.get(myId), b = devices.get(target);
        if (!a || !b)
          return send(ws, { type: 'bindResult', ok: false, reason: '对方当前不在线' });
        a.peer = target; b.peer = myId;
        codes.delete(msg.code);
        send(ws, { type: 'bindResult', ok: true, peer: target, peerUser: b.user });
        send(b.ws, { type: 'bindResult', ok: true, peer: myId, peerUser: a.user });
        break;
      }

      /* 叫醒对方：服务端实时推送 wake 给对端，对端调原生插件强提醒 */
      case 'wake': {
        if (!myId) return;
        const me = devices.get(myId);
        if (!me || !me.peer)
          return send(ws, { type: 'wakeResult', ok: false, reason: '未绑定好友' });
        const peer = devices.get(me.peer);
        if (peer && peer.ws.readyState === 1) {
          send(peer.ws, {
            type: 'wake',
            from: myId,
            fromUser: me.user,
            ts: Date.now(),
            message: msg.message || '该起床学习啦！'
          });
          send(ws, { type: 'wakeResult', ok: true });
        } else {
          send(ws, { type: 'wakeResult', ok: false, reason: '对方当前不在线' });
        }
        break;
      }

      /* 账号数据同步骨架：把本设备数据广播给绑定好友（多端互通） */
      case 'sync': {
        if (!myId) return;
        syncData.set(myId, msg.payload);
        if (msg.broadcastPeer !== false) {
          const me = devices.get(myId);
          if (me && me.peer) {
            const p = devices.get(me.peer);
            if (p) send(p.ws, { type: 'sync', payload: msg.payload, from: myId });
          }
        }
        send(ws, { type: 'syncAck', ok: true });
        break;
      }

      case 'unbind': {
        if (!myId) return;
        const me = devices.get(myId);
        if (me && me.peer) {
          const p = devices.get(me.peer);
          if (p) p.peer = null;
          me.peer = null;
        }
        send(ws, { type: 'unbindResult', ok: true });
        break;
      }

      case 'ping': send(ws, { type: 'pong' }); break;
    }
  });

  ws.on('close', () => {
    if (myId) {
      const me = devices.get(myId);
      if (me) {
        if (me.peer) {
          const p = devices.get(me.peer);
          if (p) p.peer = null;   // 通知对端关系断开
        }
        devices.delete(myId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`[考研学习助手后端] WebSocket 已启动 → ws://0.0.0.0:${PORT}/ws`);
});
