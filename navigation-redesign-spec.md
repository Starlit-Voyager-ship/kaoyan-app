# 考研学习助手 · 导航重构 & 设计规范

> 版本：`v2026-08-02y` ｜ 适用范围：双端共享 `www/`（Web + Capacitor/APK）｜ 改动性质：**仅调整入口位置，业务功能与数据逻辑零删除**

---

## 0. 设计决策说明（必读）

- **主色采用淡紫是有意识选择，非模型默认审美。** 当前 `index.html` 的 `theme-color` 为 `#6366f1`（Indigo-500），这正是业界 AI 生成的"默认紫"。本方案按你的明确要求改为**淡紫主色调**，但刻意做了两点规避，防止落入同类套路：
  1. **全程纯色平涂，零渐变**（禁止任何 `linear-gradient` / 紫→蓝紫过渡）。
  2. 把高饱和的 Indigo 下调为**低饱和、带灰度的雾感薰衣草（dusty lavender）**，读感"安静沉稳"而非"科技炫紫"。
- **图标全部改为简约线性 SVG，禁用原生 Emoji。** 当前侧边栏与头部大量使用 🏠🍅🤖 等 Emoji，已不符合扁平化要求，本方案提供可直接落地的 SVG path。
- 所有既有页面（`home / pomodoro / ai-assistant / vocab / articles / sentences / essay / math-bank / math-weak / reports / pet / friend-wake / settings` 及预留的 `politics / major`）**全部保留**，仅迁移入口。

---

## 1. 导航架构总览

### 1.1 双层导航模型
| 层级 | 形式 | 位置 | 承载内容 | 操作方式 |
|---|---|---|---|---|
| **主导航** | 底部固定 Tab Bar | 屏幕底部，5 个等宽项 | 高频 5 大核心功能 | 拇指单手点击 |
| **次导航** | 汉堡 + 左侧抽屉 | 左上角 ☰ 按钮唤起，从左侧滑出 | 全部低频专项功能（分组） | 单手可及的抽屉 |

修复旧方案"头重脚轻、单手困难"：高频功能下沉到底部 Tab（拇指热区），低频专项收入左上抽屉（不占首屏视觉重量）。

### 1.2 页面 → 新入口映射表（确认无功能删除）
| 原页面（data-page） | 原有位置 | 新位置 | 备注 |
|---|---|---|---|
| `home` 首页概览 | 侧边栏首项 | **底部 Tab 1** | 顺序固定不可改 |
| `pomodoro` 专注计时 | 侧边栏 | **底部 Tab 2** | |
| `ai-assistant` AI助理 | 侧边栏 | **底部 Tab 3** | |
| `reports` 学习报表 | 侧边栏 | **底部 Tab 4** | |
| `pet` 我的宠物 | 侧边栏 | **底部 Tab 5「我的」内嵌入口** + 保留独立整页 | 见 §5.3 |
| `settings` 设置 | 侧边栏底部 | **底部 Tab 5「我的」内嵌入口** + 保留独立整页 | |
| `vocab` 单词背诵 | 侧边栏·英语专项 | **抽屉·英语专项** | |
| `articles` 文章阅读 | 侧边栏·英语专项 | **抽屉·英语专项** | |
| `sentences` 长难句解析 | 侧边栏·英语专项 | **抽屉·英语专项** | |
| `essay` 作文模板 | 侧边栏·英语专项 | **抽屉·英语专项** | |
| `math-bank` 题库 | 侧边栏·数学专项 | **抽屉·数学专项** | |
| `math-weak` 薄弱错题 | 侧边栏·数学专项 | **抽屉·数学专项** | |
| `friend-wake` 好友叫醒 | 侧边栏底部 | **抽屉·拓展功能** | |
| `politics` 政治模块（即将上线） | 侧边栏·预留模块 | **底部 Tab 5「我的」→ 更多模块（置灰）** | 占位保留 |
| `major` 专业课模块（即将上线） | 侧边栏·预留模块 | **底部 Tab 5「我的」→ 更多模块（置灰）** | 占位保留 |
| *(新增)* `mine` 我的 | 无 | **底部 Tab 5** | 个人中心聚合页，见 §5.3 |

### 1.3 路由与激活状态规则
- 路由仍沿用 `app.navigate(page)` + `page-{page}` 显隐机制，**不新增路由框架**。
- **底部 Tab 激活**：仅 5 个主目的地参与高亮；从「我的」点进 `pet` / `settings` 子页时，底部「我的」Tab 保持激活（类 Android 行为）。
- **抽屉项激活**：抽屉内单项被选中时独立高亮，与底部 Tab 互不冲突。
- 首页 `home` 内的快捷卡片（专注/背词/录题/AI/报表）仍按原 `onclick="app.navigate('…')"` 跳转，逻辑不动。

---

## 2. 底部 Tab 主导航规范

### 2.1 布局与尺寸（具体参数）
| 参数 | 值 |
|---|---|
| 容器定位 | `position: fixed; bottom: 0; left: 0; right: 0; z-index: 50` |
| 高度 | `56px`（不含安全区）；iPhone 底部安全区再加 `env(safe-area-inset-bottom)` |
| 背景 | `var(--surface)` + 顶部 `1px solid var(--border)` 分隔线 |
| 项宽度 | 5 等分，`flex: 1`，每项 `min-height: 56px`（≥44px 触控规范） |
| 图标区 | 24×24 SVG，距文字 `4px` |
| 文字 | `11px / 500`，字距 `0.2px` |
| 主内容区 | `padding-bottom: calc(56px + env(safe-area-inset-bottom))` |
| 切换动效 | 颜色过渡 `0.2s ease`；无缩放/弹跳 |

### 2.2 五个 Tab 定义（顺序不可改动）
| # | 名称 | 路由 | 激活态 | 线性图标（SVG path，viewBox `0 0 24 24`，`stroke="currentColor" stroke-width="1.75" fill="none"`） |
|---|---|---|---|---|
| 1 | 首页概览 | `home` | 图标+文字 `var(--primary)`，图标上方 3px Primary 短横指示 | `<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5"/><path d="M9.5 20v-5.5h5V20"/>` |
| 2 | 专注计时 | `pomodoro` | 同上 | `<circle cx="12" cy="13" r="8"/><path d="M12 13V9"/><path d="M9 2.5h6"/><path d="M18.5 6 20 4.5"/>` |
| 3 | AI助理 | `ai-assistant` | 同上 | `<path d="M12 3.5c.35 3 1.65 4.3 4.7 4.65-3.05.35-4.35 1.65-4.7 4.65-.35-3-1.65-4.3-4.7-4.65 3.05-.35 4.35-1.65 4.7-4.65z"/><path d="M18.5 14.2c.18 1.3.82 1.9 2.1 2.1-1.28.2-1.92.8-2.1 2.1-.18-1.3-.82-1.9-2.1-2.1 1.28-.2 1.92-.8 2.1-2.1z"/>` |
| 4 | 学习报表 | `reports` | 同上 | `<path d="M4 20V11"/><path d="M10 20V4.5"/><path d="M16 20V13"/><path d="M3 20.5h18"/>` |
| 5 | 我的 | `mine` | 同上 | `<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20c.6-3.4 3.8-5.5 7.5-5.5s6.9 2.1 7.5 5.5"/>` |

> 激活指示条：在激活项图标顶部加 `width:20px; height:3px; border-radius:2px; background:var(--primary); margin:0 auto 4px`，未激活项不显示。

### 2.3 图标规范总则（强制）
- **统一线性风格**：`fill="none"`、`stroke="currentColor"`、`stroke-width="1.75"`、`stroke-linecap="round"`、`stroke-linejoin="round"`。
- **禁用 Emoji**、禁用彩色扁平图标、禁用品牌彩色 SVG。
- 单色继承 `currentColor`：未激活 `var(--text-tertiary)`，激活 `var(--primary)`。
- 视窗统一 `viewBox="0 0 24 24"`，渲染尺寸 24×24（2x 屏天然清晰，无需多倍图）。

---

## 3. 左上角汉堡 + 侧边抽屉

### 3.1 触发与关闭
- **汉堡按钮**：置于 `header` 左上角，替换原 `☰` Emoji，使用线性图标：
  `<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>`（24×24，`stroke="currentColor" stroke-width="1.75"`）。
- **打开**：点击 ☰ → 抽屉 `transform: translateX(0)` + 遮罩 `opacity:1; visibility:visible`。
- **关闭**：① 点遮罩；② 点抽屉内右上角 ✕（线性 `<path d="M6 6l12 12"/><path d="M18 6 6 18"/>`）；③ 选任一项后自动关闭；④（可选）左滑手势。
- 头部右侧原 `👤 个人中心` 按钮**移除**（功能并入底部「我的」Tab）；`🐾 桌宠` 按钮保留，图标改为线性爪印（见 §3.3 我的宠物图标）。

### 3.2 抽屉布局（分组结构 · 严格按你给定）
| 参数 | 值 |
|---|---|
| 宽度 | `288px`（移动端 `min(82vw, 320px)`） |
| 背景 | `var(--surface)`（纯白，无渐变） |
| 顶部 | 用户信息条：圆形头像（线性爪印/首字母）+ 用户名 + 右侧 ✕ |
| 分组标题 | 小字 `12px / 600`，`var(--text-tertiary)`，字距 `0.5px`，上方 `16px` 间距，下方 `8px`，可选左侧 3px 短竖条 `var(--primary)` |
| 子项缩进 | 图标左对齐抽屉图标列，文字相对分组标题缩进 `12px` |
| 行高 | 每项 `height: 48px`，`min 44px` 触控 |
| 底部 | 版本号小字 `var(--text-tertiary)` |

**菜单树（唯一权威结构）：**
```
┌─ 用户信息条（头像 + 用户名 + ✕）
├─ 英语专项
│   ├─ 单词背诵      → vocab
│   ├─ 文章阅读      → articles
│   ├─ 长难句解析    → sentences
│   └─ 作文模板      → essay
├─ 数学专项
│   ├─ 题库          → math-bank
│   └─ 薄弱错题      → math-weak
├─ 拓展功能
│   └─ 好友叫醒      → friend-wake
└─ （底部）版本 v2026-08-02y
```
> 说明：`pet` / `settings` / `logout` / 预留模块**不放抽屉**（已移入底部「我的」），避免抽屉再次"头重"。

### 3.3 抽屉每项图标（线性 SVG，viewBox `0 0 24 24`，`stroke-width="1.75"`，`fill="none"`，`stroke="currentColor"`）
| 项 | 图标 path |
|---|---|
| 英语专项（组标题） | `<path d="M12 6.2C10.3 5.2 7.8 5 5 5.4V18c2.8-.4 5.3-.2 7 .8 1.7-1 4.2-1.2 7-.8V5.4c-2.8-.4-5.3-.2-7 .8z"/><path d="M12 6.2V19"/>` |
| 单词背诵 | `<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8 9.5h8M8 13h8M8 16.5h5"/>` |
| 文章阅读 | `<path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M13.5 3.5V8H18"/><path d="M9.5 12h6M9.5 15.5h6"/>` |
| 长难句解析 | `<path d="M9 6 4.5 12 9 18"/><path d="M15 6l4.5 6L15 18"/>` |
| 作文模板 | `<path d="M4 20l4.5-1.2 9.8-9.8a1.6 1.6 0 0 0 0-2.3l-1.8-1.8a1.6 1.6 0 0 0-2.3 0L4.8 14.7z"/><path d="M13.5 6.5l3 3"/>` |
| 数学专项（组标题） | `<rect x="5" y="3" width="14" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01"/>` |
| 题库 | `<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>` |
| 薄弱错题 | `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>` |
| 拓展功能（组标题） | `<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>` |
| 好友叫醒 | `<path d="M18 8.5a6 6 0 1 0-12 0c0 6.5-2.5 8.5-2.5 8.5h17S20.5 15 18 8.5z"/><path d="M13.5 21a2 2 0 0 1-3 0"/>` |
| 我的宠物（仅「我的」页用） | `<circle cx="6.5" cy="11" r="1.5"/><circle cx="17.5" cy="11" r="1.5"/><circle cx="9.5" cy="7" r="1.5"/><circle cx="14.5" cy="7" r="1.5"/><path d="M12 13.5c-2.8 0-4.7 1.8-4.7 4.2 0 .9.7 1.3 1.8 1.3 1 0 1.4-.8 2.9-.8s1.9.8 2.9.8c1.1 0 1.8-.4 1.8-1.3 0-2.4-1.9-4.2-4.7-4.2z"/>` |
| 设置（仅「我的」页用） | `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>` |
| 退出登录（仅「我的」页用） | `<path d="M14.5 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h11"/>` |
| 预留模块（即将上线，置灰） | `<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>` |

### 3.4 抽屉交互与动效
| 项 | 值 |
|---|---|
| 滑入 | `transform: translateX(-100%) → 0`，`transition: transform 0.25s cubic-bezier(.4,0,.2,1)` |
| 遮罩 | `background: rgba(42,39,48,.45)`，`opacity 0→1`，`0.2s` |
| 子项 Hover（桌面） | 背景 `var(--primary-soft)` |
| 子项 Active（当前页） | 文字 `var(--primary)` + 左侧 `3px solid var(--primary)` 竖条 + 背景 `var(--primary-soft)` |
| `prefers-reduced-motion` | 禁用 transform/opacity 过渡，直接显隐 |
| 关闭后焦点 | 返回触发 ☰ 的按钮（可访问性） |

---

## 4. 视觉设计规范（Design System）

### 4.1 配色 Token（`main.css` 中以 CSS 变量落地，hex 为权威，oklch 近似供参考）
| Token | Hex | oklch(近似) | 用途 |
|---|---|---|---|
| `--primary` | `#6E5CA8` | `oklch(.48 .09 295)` | 主色：激活 Tab、主按钮、关键强调（雾感薰衣草，非 Indigo） |
| `--primary-hover` | `#5C4A96` | `oklch(.40 .10 295)` | 主按钮按下/hover |
| `--primary-soft` | `#ECE9F4` | `oklch(.94 .015 295)` | 选中背景、激活指示、抽屉 active 底 |
| `--primary-mid` | `#A99DC9` | `oklch(.72 .06 295)` | 进度条、次要填充 |
| `--bg` | `#F7F7FA` | `oklch(.98 .003 295)` | App 背景（微冷近白） |
| `--surface` | `#FFFFFF` | — | 卡片/抽屉/底栏背景 |
| `--text-primary` | `#2A2730` | `oklch(.16 .01 300)` | 正文/标题 |
| `--text-secondary` | `#6E6A78` | `oklch(.46 .015 300)` | 次级文字 |
| `--text-tertiary` | `#9B97A6` | `oklch(.64 .012 300)` | 提示/未激活 Tab/占位 |
| `--border` | `#ECEAF1` | `oklch(.93 .008 300)` | 分隔线/描边 |
| `--overlay` | `rgba(42,39,48,.45)` | — | 抽屉遮罩 |
| `--danger` | `#C25B6B` | `oklch(.55 .10 15)` | 删除/退出（柔和玫红，避免刺眼大红） |
| `--success` | `#5FA37A` | `oklch(.62 .08 150)` | 成功态 |
| `--focus-ring` | `rgba(110,92,168,.35)` | — | 键盘焦点环 |

> `theme-color` meta 改为 `#6E5CA8`；版本角标背景由 `#4f46e5` 改为 `var(--primary)`。

### 4.2 字体
- **字体栈（中文优先，禁用 Inter/Roboto/Arial）：**
  `font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif;`
- **可选增强**：如需更 distinctive 的拉丁字形，可加载 `Noto Sans SC`（Web/APK 内联 woff2），中文仍走系统字体。
- **字号阶梯（基准 16px）：**
  | 角色 | 大小 | 字重 | 行高 |
  |---|---|---|---|
  | 页面标题 H1 | 20px | 600 | 1.4 |
  | 区块标题 H2 | 17px | 600 | 1.4 |
  | 卡片标题 H3 | 15px | 600 | 1.4 |
  | 正文 Body | 14px | 400 | 1.6 |
  | 说明 Caption | 12px | 400 | 1.5 |
  | Tab 标签 | 11px | 500 | 1.2 |

### 4.3 间距 / 圆角 / 阴影（扁平化）
- **间距标尺（4 基线）：** `4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 px`
- **圆角：** 卡片 `12px`、按钮/输入 `10px`、抽屉 `0`（左缘齐屏，右缘 `16px`）、头像 `50%`、标签 chip `999px`
- **阴影（极轻，体现扁平）：**
  - 卡片：`0 1px 2px rgba(42,39,48,.04), 0 4px 16px rgba(42,39,48,.06)`
  - 底栏/抽屉：`0 -1px 0 var(--border)`（仅分隔线，无投影）或 `0 2px 12px rgba(42,39,48,.05)`
- **动效时长：** 统一 `0.2–0.25s ease`；过渡仅作用于颜色/透明度/transform，禁止位移弹跳。

### 4.4 组件状态规范（default / hover / active / focus / disabled）
| 组件 | default | hover | active | focus | disabled |
|---|---|---|---|---|---|
| 底部 Tab | 图标/文 `tertiary` | 文 `secondary` | 图标/文 `primary`+指示条 | 外环 `focus-ring` | — |
| 抽屉子项 | 文 `secondary` | 底 `primary-soft` | 文 `primary`+左条+底 `primary-soft` | 外环 `focus-ring` | 文 `tertiary`+`opacity .5`+不可点 |
| 主按钮 `.btn-primary` | 底 `primary`/文白 | 底 `primary-hover` | 底 `primary-hover`+微缩放 | 环 `focus-ring` | 底灰/文淡/禁点 |
| 次按钮 `.btn-secondary` | 底 `primary-soft`/文 `primary` | 底略深 | 同 | 环 `focus-ring` | 淡 |
| 输入框 | 底白/边 `border` | 边 `primary-mid` | — | 边 `primary`+环 `focus-ring` | 底灰 |

---

## 5. 页面级布局调整

### 5.1 Header（顶部栏）
- 左：`☰` 汉堡（线性）→ 开抽屉；右侧 `页面标题`（居中或紧接汉堡）。
- 右：**移除** `👤 个人中心` 按钮；保留 `🐾 桌宠` 但图标改为线性爪印（§3.3 我的宠物图标），点击仍调用 `DesktopPet.toggle()`。
- 标题映射表 `titles` 在 `app.js` 中**新增 `mine: '我的'`**。

### 5.2 首页 `home`
- 布局、统计卡、快捷入口**全部保留**，逻辑不动。
- 仅建议：快捷入口图标同步线性化（与全局一致），可复用 §3.3 图标；不影响功能。

### 5.3 新增「我的」页（`page-mine`）
结构（自上而下）：
1. **用户信息卡**：圆形头像（首字母/爪印）+ 用户名 + 目标副标题（如"考研目标 · 数学二"）。
2. **宠物状态卡**（紧凑）：显示宠物名/Lv/金币，点击 → `app.navigate('pet')`。
3. **功能列表**（线性图标 + 文字，整行可点）：
   - 我的宠物（爪印）→ `pet`
   - 设置（齿轮）→ `settings`
   - 退出登录（logout，文字 `danger` 色）→ `Auth.handleLogout()`
4. **更多模块**（置灰区，标题"即将上线"）：政治模块、专业课模块，使用 §3.3 预留图标 + `coming-soon` 小标签，点击 `Utils.toast('该模块即将上线')`。

> 该页仅作**聚合入口**，不复制 `pet`/`settings` 的业务逻辑；点进去仍是原独立整页。

---

## 6. 保留业务功能清单（QA 自查 · 确认零删除）
- [x] 专注计时（番茄钟/统计/设置）
- [x] AI 助理（上传归档 + 智能解答双 Tab、千问VL/DeepSeek 配置）
- [x] 单词背诵（背/测/词表/错词本）
- [x] 文章阅读（列表/阅读器/翻译/答题）
- [x] 长难句解析（列表/详情）
- [x] 作文模板（增删改查）
- [x] 数学题库（AI 录入/筛选/详情）
- [x] 薄弱错题（汇总/统计）
- [x] 学习报表（日报/周报）
- [x] 我的宠物（桌宠/商店/金币规则）
- [x] 好友叫醒（绑定/长按叫醒/原生强提醒）
- [x] 设置（API Key/宠物名/桌宠开关/导出/清除）
- [x] 预留模块占位（政治/专业课）
- [x] 数据云同步（Bmob）、导出/清除、登录注册

---

## 7. 前端可直接落地的改动清单
1. `index.html`
   - `<meta name="theme-color" content="#6E5CA8">`
   - 顶部 `header`：☰ 改线性 SVG；删 `user-menu-btn`；🐾 改线性爪印；`app.js` 标题表加 `mine`。
   - 新增 `#page-mine` 区块（按 §5.3）。
   - 新增底部 Tab Bar DOM（5 项，含 §2.2 SVG）。
   - 侧边栏 `nav#sidebar`：仅保留 §3.2 三组菜单（删 pet/settings/friend-wake 旧位置与预留模块，friend-wake 移入拓展功能）。
   - 版本角标背景改 `var(--primary)`。
2. `css/main.css` / `components.css`：注入 §4.1 全部 CSS 变量；新增 `.tabbar` / `.tab-item` / `.drawer-group` / `.drawer-item` 样式；图标类统一 `currentColor` 线性。
3. `js/app.js`
   - `bindGlobalEvents`：绑定底部 Tab 点击 → `navigate(tab, {fromTab:true})`。
   - `navigate(page, opts)`：维护 `data-tab` 与 `data-page` 两套高亮；从「我的」进子页时底部「我的」保持激活。
   - `titles` 增加 `mine: '我的'`。
   - `onPageEnter` 增加 `case 'mine'`（渲染用户信息/宠物摘要）。
4. 全局 Emoji 替换为线性 SVG：首页快捷卡、各页 empty-icon、按钮内 Emoji 等，统一引用 §2.2/§3.3 图标集（可抽成 `<svg class="ico">` 复用）。
5. `prefers-reduced-motion` 媒体查询：抽屉/底栏动效降级。

---

## 8. 质量校验摘要（QA）
- **AI 味检测**：规避了"紫渐变/Indigo 默认/Emoji 图标/三列 icon 卡"等套路；紫为主色为显式用户选择并全程平涂。✅
- **可访问性**：Tab/抽屉项 ≥44px；主文对比 `var(--text-primary)` on `#FFF` ≈ 13:1（AAA）；主色 `#6E5CA8` on `#FFF` ≈ 5.3:1（AA）；焦点环 `--focus-ring`；`prefers-reduced-motion` 支持。✅
- **层级与节奏**：高频下沉底部、低频收抽屉，首屏视觉重量下移；间距标尺统一 4 基线；圆角/阴影克制。✅
- **交互状态**：Tab 与抽屉均定义 default/hover/active/focus，主按钮含 disabled，预留模块 disabled 态明确。✅
- **终检**：5 Tab 顺序固定不可改；原功能零删除；淡紫主色、扁平线性、安静沉稳目标达成。可交付。⚠️ 如需我直接改 `index.html`/`main.css`/`app.js` 落地，说一声即可。
