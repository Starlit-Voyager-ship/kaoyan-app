# 考研学习助手 · 工程接续文档（英语AI阅读识别专项）

> 本文档为「英语文章 AI 上传识别」模块的接手续档。新会话读取后，无需重新理解需求，直接从 ⑥ 接续引导 的中断位置继续开发。

## ① 项目总览

### 定位
- 手机（Capacitor Android APK）+ 电脑（Web / GitHub Pages）双端互通的考研学习软件
- 云同步：Bmob（Store 双写 本地 IndexedDB + 云端 AppData）
- 代码仓库：Starlit-Voyager-ship/kaoyan-app
- 本地工程路径：C:/Users/yansh/WorkBuddy/考研软件/考研学习助手
- 桌面 APK 产出：C:/Users/yansh/Desktop/kaoyan-study-helper-debug.apk

### 核心功能模块（已上线）
- 背单词（vocab_words / vocab_known / vocab_plan / learn_progress / daily_checkin / vocab_streak）
- 数学（math_questions / math_weak_points）
- 英语（sentences / articles / essays）
- AI 助手（ai_chats；英语文章上传识别走此链路）
- 桌面宠物（pet_data / coins / pet_pos；PetUI.mount()）
- 倒计时（countdown）、番茄钟（pomodoro_records / pomo_tasks / pomo_todos）
- 报表（reports）、好友叫醒（WakeStore → WakeBind/WakeMsg）

### 开发目标
- 双端数据互通、离线优先、平台原生体验
- AI 上传英语文章：拍/传图 → 识别全文 + 拆分题目 + 生成解析，渲染成可阅读、可答题的页面

### 整体进度
- 主体功能完成；当前重心是「英语 AI 阅读识别质量」持续迭代（已迭代 9 轮）
- 最新构建：commit 3da5519（分段修复尝试，但实测仍无效，见 ③.3.1）

---

## ③ 当前未完成清单（写到一半 / 待调试，标注卡点）

### 3.1 英语文章分段显示【当前最高优先级卡点】
- 现象：用户传清晰英文文章，AI 识别正确，但渲染后全文连成一大段，无段落层次
- 用户原话期望：「分段是指这段开始空两个汉字的距离」= 段首缩进 2 字（text-indent: 2em）
- 已完成代码（无需重做）：
  - ai-assistant.js 312-369：两段式管线，最终 `articleText` 经 `_cleanArticleText()` 存入 articles.content
  - ai-assistant.js ~744：`_cleanArticleText(raw)` 删页脚/试卷标题 + 合并空行 + 零空行兜底按 `[.!?]\s+[A-Z][a-z]` 切段
  - articles.js 360-412：`renderReaderContent()` 按 `/\n\s*\n+/` split → 每段包 `<div class="reader-para">` + `<p class="reader-en">`
  - modules.css 2037：`.reader-para { margin-bottom: 16px }`（仅有段间距，无首行缩进）
- 未解决 / 卡点（三选一或叠加）：
  - [断点A] AI 输出的 article 字段很可能仍是单段（VL/Stage2 prompt 强约束「段间空行」未稳定生效），导致 content 无 `\n\n`，split 只出 1 段
  - [断点B] CSS 只有段间距 `margin-bottom:16px`，缺 `text-indent: 2em`；即使用户看到间距也不符合「段首空两字」预期
  - [断点C] `_cleanArticleText` 兜底切段依赖 `[.!?]\s+[A-Z][a-z]` 正则，对英文真题复杂长句可能切不出合理段数（或切太碎）
- 中断位置：正要 console.log 确认 AI 实际输出是否含 `\n\n` 时被用户打断（用户要求先出本接续文档）
- 接续人直接做（见 ⑥）：
  1. 在 ai-assistant.js doUpload english 分支 `analysis = JSON.stringify(parsed)` 后加 `console.log('[ARTICLE_RAW]', parsed && parsed.article)`，真机/本地看 AI 真实输出是否分段
  2. 若 AI 输出单段 → 强化 `_cleanArticleText`：英文用「句末标点+大写新句首」切，段数收敛 4-6；中文用句号/换行切
  3. 给 `.reader-en`（或 `.reader-para`）补 `text-indent: 2em`（中英文均可用首行缩进，匹配用户描述）
  4. bump index.html 缓存戳 + www/sw.js CACHE 名 → commit → push → 等 build-apk.yml → 下 APK 实测

### 3.2 其他待实现 / 待调试
- articles.js 418 `startQuiz()`：阅读答题功能仅 `Utils.toast('阅读答题功能开发中...')` 占位，未实现
- 数学/英语 AI 解析更多题型覆盖：未系统测试边界情况
- 好友叫醒 WakeMsg 后台：权限向导曾回退，依赖用户手动开系统自启动/电池白名单（华为/OPPO）
- 设置类 `settings_<user>` 仍仅本地，不跨端

---

## ④ 历史约束要求（硬性规则，不可违反）

### 4.1 代码风格
- 变量/方法用 ASCII 引号；JSON 键用双引号；不裸露 `<input type="date">` / `<select>` 无 data 属性
- 日期/下拉统一用 widgets.js 的 `data-date-pill` / `data-custom-select`
- 图标统一线性 SVG（stroke 1.75, 24x24）；全站 Emoji 已清零
- Edit/Python 改写 JS 后必须 `node --check` 防语法错误

### 4.2 互通架构
- Bmob 数据按 `Bmob.dataUserId`（规范名）存/取，禁直接用 `Bmob.username`
- 图片不存云端，只同步识别后文字
- 业务数据走 `Store.put/get`（云端 AppData + 本地 IndexedDB 双写）
- 双端同步前提：`Bmob.isLoggedIn()`，否则仅本地
- 已接入 Store 模块表见 MEMORY.md（背单词/数学/英语/AI/宠物/倒计时/番茄钟/报表/好友叫醒）

### 4.3 AI 代理架构（英语识别核心铁律）
- 两段式管线：Stage1 `qwen-vl-max` 只逐字抄写（plain text，max_tokens 6000, temperature 0.1，禁出 JSON）；Stage2 `qwen-max` 拆 `{summary, article, questions[]}`
- 长图（高/宽比>1.4）竖向切分；≤2 张用 `Utils.splitLongImage`（ratio<1.4 不切；1.4-2.4 切2段；≥2.4 切3段）；>2 张不切分
- 平台自适应预算：App 原生环境 `MAX_TOTAL=220KB`，浏览器 36KB（aiProxy 限制）
- 上传 ≤2 张时 `_buildTranscribeImages` 先切分再按预算压缩（ladder：App 内 1600/0.9 起步，浏览器 1400/0.82 起步）
- 所有识别/解析失败必须有兜底：正则抓题（`_extractRawQuestions`）、raw 折叠区、toast 提示；不得空结果/静默失败

### 4.4 界面要求
- 全局 UI 规范见 global-ui-spec.md；背景蓝天白云 + 浅蓝兜底
- mobile `content-section` padding 必须拆分写（基类 padding-bottom 含 tabbar 安全间距），不能用 shorthand 覆盖
- 桌面元素 z-index：底部tab=1000 / 通用模态=10000 / 桌面宠物=9998 / 宠物panel=10010 / toast=10020
- AI 解析区不渲染文章正文（阅读区已渲染）；题干加粗 `.ai-q-text { font-weight:700 }`

### 4.5 RAG 知识库接入
- 本次对话未涉及 RAG 检索；当前英语识别走 qwen 直连 + prompt 约束
- 若项目规划要求 RAG（如考研真题库/词汇库检索增强），需后续补充接入，不在本轮回合范围

### 4.6 不允许随意简化逻辑
- 识别不全/解析失败不得用「空结果」或「静默跳过」代替；必须有可见兜底（正则/raw/toast）
- 长文识别不得为省 token 过度压缩导致丢字（曾因此翻车，已定 App 220KB 预算）
- prompt 约束必须对应「过去翻车过的具体形态」，不写空话

---

## ⑤ 遗留问题（中断原因 + 必须规避的坑）

### 5.1 本次会话中断原因
- 排查「分段」问题时多个后台任务（APK 下载/构建轮询）回调穿插，用户打断要求先出接续文档
- 分段根因未 100% 定位（AI 输出单段 vs CSS 无缩进 二选一未验证）

### 5.2 必须规避的坑
- APK 下载：Azure 302 重定向 URL 自带 SAS，必须剥离 Authorization 用 PowerShell `Invoke-WebRequest -Headers @{Authorization='token ...'}` 下载；Bash 沙箱会掐断 Azure 下载
- artifact 命名：每个 run 有 2 个（gradle-build-log ~75KB 与 kaoyan-study-helper-debug-apk ~11MB），必须按 name 命中后者，否则下到假包
- SW 缓存：影响渲染的 CSS/JS 改动必须 bump www/sw.js 的 CACHE 名（v1→v2），否则旧 CSS 残留诡异 bug
- 二进制资源必须随代码 commit（GIF/图片/字体进 www/对应目录），光 commit JS/CSS 不够，APK 不装
- 长文识别：VL 边看图边出结构化 JSON 必丢字 → 必须用两段式（VL 只抄写）
- 段落：VL 默认「接续输出」不分段 → prompt 必须显式「段间空行」；且前后端 + 双层兜底都不能少
- 页脚过滤用整行正则 `^...$` 而非全文 substring，避免误伤正文中出现的「2007 年考研试题」字样

---

## ⑥ 接续引导（新会话直接从此继续）

读取本文档后，无需重新理解需求，直接从上一次中断位置继续开发：

1. 【首要任务】修复 ③.3.1「英语文章分段显示」
   - 先 `console.log('[ARTICLE_RAW]', parsed && parsed.article)` 确认 AI 真实输出是否含 `\n\n`
   - 按断点 A/B/C 依次排查
2. 补 CSS：`.reader-en { text-indent: 2em; }`（段首空两字，匹配用户描述）
3. 若 AI 输出单段：强化 `_cleanArticleText` 兜底切段（英文句末+大写首字母，收敛 4-6 段；中文句号/换行）
4. bump index.html 缓存戳（ai-assistant.js / articles.js / utils.js 各自的 ?v=）+ www/sw.js CACHE 名
5. `git commit` → `git push origin main` → 等 build-apk.yml → 按 name 命中 `kaoyan-study-helper-debug-apk` 下载到桌面
6. 实测分段效果，确认「段首空两字」达成；再推进 ③.3.2 其他待办
7. 每次实质改动后追加 C:/Users/yansh/WorkBuddy/考研软件/.workbuddy/memory/YYYY-MM-DD.md
