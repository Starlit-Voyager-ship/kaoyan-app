# 考研学习助手 — 代码审计报告

**审计日期**：2026-08-04
**审计范围**：`www/js/` 全部 22 个 JS 模块 + `index.html` + `sw.js` + GitHub Pages 部署流水
**审计目标**：排查后端（Bmob 云同步）问题、各模块双端互通（Web ↔ Android APK）问题、运行期 bug
**触发**：用户反馈"线上没显示" + 要求从头逐行排查

---

## 1. 排查方法

| 方法 | 结果 |
|---|---|
| 语法体检 `node --check` 全量 JS | 22 个文件全部通过，无语法错误 |
| 运行期逻辑审计（人工逐文件） | 见 §3、§4 |
| 存储层 / 双端同步专项核查 | 见 §3.1、§5 |
| 子 Agent 深度扫描其余模块 | 见 §5 确认项 |

---

## 2. 线上"没显示"根因与修复（已闭环）

**结论**：代码已正确推送（`local = origin/main = a3b0c0b`），22 个 JS 语法全过，不是代码崩。

**根因链**：
1. `sw.js` 从未被 `serviceWorker.register`（index.html:894 注释写明"故意禁用 SW 以避免旧 JS 缓存"）→ 离线能力缺失，但换来"改了立刻生效"。
2. 既然 SW 关着，**index.html 里脚本的 `?v=` 查询串成为唯一缓存炸蛋**。审计发现 15 个 JS 仍用 `?v=20260803X` 旧戳 → 08-04 加的删除功能沿用了旧串 → 浏览器按旧 URL 喂了缓存。

**修复**：所有 `?v=20260803X` 统一 bump 到 `20260804d`，强制浏览器重新拉取。用户硬刷（Ctrl+Shift+R）即可见。

---

## 3. 已修复的 Bug（4 个，已推送）

### 3.1 [🔴 严重] 宠物不持久化
- **位置**：`www/js/store.js` → `savePet()`
- **现象**：宠物等级 / 饥饿 / 金币每次刷新全重置；云端累积一堆重复行
- **根因**：`savePet` 调 `put('pet_data', pet)` 但 `pet` 对象**从不带 `id`** → 存成 `pet_data::undefined`；`getPet` 按 `'pet_'+user` 查找永远落空
- **修复**：`savePet` 兜底 `petData.id = 'pet_' + user`，与云端/本地键对齐

### 3.2 [🟡 可见] 番茄金币提示夸大
- **位置**：`www/js/pomodoro.js` 结束提示
- **现象**：toast 显示 `+分钟×10` 金币，但你已把 per 改成 1，实际只给分钟数 → 提示撒谎
- **修复**：改为动态读 `LEARN_REWARDS.pomodoro_per_min.per`

### 3.3 [🟡 数据] AI 图片误存云端
- **位置**：`www/js/ai-assistant.js` 发图分支
- **现象**：先把**含 base64 图**的 userMsg `put` 云端，**之后**才置空 → 违背"只同步文字"设计，浪费 Bmob 配额
- **修复**：移到图片置空之后再 `put`，云端不再存图

### 3.4 [🔴 启动风险] IndexedDB 缺失致 app 白屏（本轮新增修复）
- **位置**：`www/js/store.js` → `_initLocal()`
- **现象**：老旧 WebView / 隐私模式 / `file://` 直接打开时，`indexedDB` 全局可能不存在 → 第 26 行 `indexedDB.open()` 直接抛 `ReferenceError` → `init()` 的 `await this._initLocal()` 失败 → **整个 app 启动崩溃白屏**
- **根因**：缺少 `typeof indexedDB` 检测，且 `indexedDB.open` 未包 try-catch
- **修复**：加 `typeof indexedDB === 'undefined'` 检测 + 整段 try-catch；缺失时 `this.db = null` 并 `resolve()` 不阻塞启动。db=null 时所有 `_cache*` 方法已对 null 安全返回（仅丢离线缓存、功能不丢）

---

## 4. 本次新增：IndexedDB 启动崩溃降级

这是审计后续项"IndexedDB 健壮性"的实质落地（见 §6.2）。改动仅 `store.js` 的 `_initLocal()` 一段，零副作用：

```js
_initLocal() {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      this.db = null;
      console.warn('[Store] 当前环境不支持 IndexedDB，本地缓存降级为云端优先');
      return resolve();
    }
    try {
      const req = indexedDB.open(this.dbName, 2);
      req.onupgradeneeded = (e) => { /* 建 cache / users 表 */ };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
      req.onerror = () => { this.db = null; resolve(); };
    } catch (e) {
      this.db = null;
      console.warn('[Store] IndexedDB 初始化异常，降级为云端优先', e);
      resolve();
    }
  });
}
```

---

## 5. 审计确认无问题的点（安心项）

- ✅ **删除链路 id 一致**：数学题库 / 薄弱 / 文章 / 长难句 4 模块的 `Store.delete(storeName, id)` 与当初 `Store.put` 的 `data.id` 完全匹配，能正确删云端+本地，无"存了没 id 删不掉"
- ✅ **跨模块引用无未定义**：`Store` / `Pet` / `Utils` / `app.*` / `window.confirmDeleteItem` 全部真实存在
- ✅ **数据隔离正确**：`Bmob.dataUserId` 与 `Store.currentUser` 登录后始终绑定同一规范名（如 `123`），各账号只读写自己数据，双端互通不拆库
- ✅ **AI 代理 / 好友叫醒链路完整**：`proxyMode='bmob'` 正确走云函数；friend-wake 云端优先 + IndexedDB 兜底、游标防重
- ✅ **pet.id 兜底后宠物持久化恢复**：§3.1 修复后，等级/金币/领养选择可正确跨刷新保存并双端同步

---

## 6. 后续项决策（未实施，附理由）

### 6.1 启用 SW 注册（补离线能力）
- **决策**：**暂不实施**
- **理由**：index.html 注释故意禁用 SW，换取"改完立刻生效"。若启用 `register` + 缓存策略，会导致部署后旧 JS 仍生效（需二次刷新 / 版本戳管理），回到"改了不生效"老坑。当前离线缺失，但双端在线同步正常、功能完整。如将来要离线壳，需配套"部署后自动清缓存 + 版本戳"方案再启用。

### 6.2 IndexedDB → localStorage 完整降级（离线缓存兜底）
- **决策**：本轮仅做"防启动崩溃"降级（`db=null` 时已安全返回），**未做 localStorage 缓存层**
- **理由**：`db=null` 时 `put` 仍写云端、`get` 走云端优先，**功能不丢，仅无离线缓存**；当前线上 / Capacitor 环境 IndexedDB 均可用，优先级低。如需离线缓存兜底，可加 localStorage 索引层（补丁见下，不强制）：

```js
// 可选补丁：在 _cachePut/_cacheGet 中，db 为 null 时退回 localStorage
_cachePutLS(cid, data) {
  try { localStorage.setItem('kv_' + cid, JSON.stringify(data)); } catch {}
}
_cacheGetLS(cid) {
  try { return JSON.parse(localStorage.getItem('kv_' + cid)); } catch { return null; }
}
```

---

## 7. Top 5 必须修清单（回顾）

| # | 问题 | 严重度 | 状态 |
|---|---|---|---|
| 1 | 宠物不持久化（pet 无 id） | 🔴 严重 | ✅ 已修 |
| 2 | `?v=` 缓存炸蛋导致线上不更新 | 🟠 阻断 | ✅ 已修 |
| 3 | 番茄金币提示夸大 ×10 | 🟡 可见 | ✅ 已修 |
| 4 | AI 图片误存云端 | 🟡 数据 | ✅ 已修 |
| 5 | IndexedDB 缺失致启动白屏 | 🔴 启动风险 | ✅ 本轮已修 |

---

## 8. 遗留 / 观察项（非 bug，待后续处理）

- ⚠️ **测试账号脏数据**：云端有测试账号（123 / 1234 / kaoyan2026 等），交付前需清理
- ⚠️ **git remote 含明文 token**：建议 Revoke 后改用 SSH / GitHub App
- ⏳ **RAG 知识库**：用户硬性需求，尚未接入，待确认语料 / 向量库 / 检索链路
- 🔧 **SW 离线能力**：见 §6.1，按需启用

---

**审计人**：Mobile App Builder（小诗）
**报告生成**：2026-08-04 22:30
**最新 commit**：IndexedDB 启动崩溃降级 + 审计报告
