# 考研学习助手 — APK 出包与部署指南

> 项目已用 **Capacitor** 改造为「网页资源 + Android 原生壳」，原生插件 `WakeAlarm` 实现
> **绕过免打扰的强提醒叫醒**。本沙盒（无 Java / Android SDK）只完成了工程与代码，
> **APK 需在你本地或云端 CI 编译**。

---

## 一、出 APK 的环境要求（必须）
- **Node.js 18+**（本机为 22，已满足）
- **Java JDK 17**（Android Gradle 要求，别用 8 / 21）
- **Android SDK**：Android 14 (API 34) 平台 + Build Tools 34.x
- **Android Studio**（推荐，自带 SDK/Gradle）；或单独装 SDK + 命令行
- Gradle 由 Capacitor 自动下载，无需手动装

---

## 二、本地出包（Android Studio，最常用）
1. 装 JDK 17、Android Studio；打开 SDK Manager 装 **Android 14 (API 34)** 与 **Build Tools**。
2. 项目根执行：
   ```bash
   npm install
   npx cap sync android     # 把 www/ 最新前端同步进 android 工程
   ```
3. Android Studio → **File → Open** → 选本项目的 `android/` 文件夹。
4. **Build → Generate Signed Bundle / APK → APK** → 创建/选择签名密钥 → release → Finish。
5. 产物：`android/app/release/app-release.apk`。

### 纯命令行（已配好 `ANDROID_HOME` 与 SDK）
```bash
npx cap build android      # 等价于 sync + gradle 打包，按提示选签名
```

---

## 三、云端 CI 自动出包（不用装 Android Studio）
1. 把项目推到 **GitHub 私有仓库**（含 `android/` 与 `www/`）。
2. 添加 `.github/workflows/build-apk.yml`，用 `gradle-build-action` / `r0adkll/sign-android-release`
   构建，产物作为 **Artifact** 下载。
3. 我可帮你生成该 workflow 文件（需要你有 GitHub 账号）。
4. 每次 push 自动出包，在 Actions 页面下载 APK。

---

## 四、手机安装
- **安卓 / 鸿蒙 4.2**：把 `app-release.apk` 传到手机 → 点击安装。
  若提示「未知来源」，去 **设置 → 安全 → 允许安装未知来源应用** 授权后再装。
- 鸿蒙 4.2 兼容安卓 APK，可直接装。

---

## 五、后端部署（好友叫醒 + 数据同步）
好友叫醒与数据同步都走 **Bmob 云**（`WakeBind/WakeMsg` + `AppData`），**无需自建 WebSocket 后端**。
仓库里的 `server.js` 是早期 WebSocket 方案，现仅作历史参考，**不要部署**；`ws` 依赖保留仅用于兼容旧 lockfile。

---

## 六、叫醒「绕过免打扰」授权引导（关键）
安装后首次使用需授权，否则强提醒可能被静音：
1. **通知权限**：Android 13+ 首次弹窗请求 `POST_NOTIFICATIONS`，点允许。
2. **覆盖勿扰**：在叫醒页提供一个「授权勿扰」入口（前端调用原生
   `Capacitor.Plugins.WakeAlarm.requestDndAccess()` 跳转系统设置），用户开启
   「允许通知访问 / 勿扰例外」。
3. 即便未授权，原生插件播放的 **`TYPE_ALARM` 闹钟声**在多数 DND 设置下仍会响
   （系统给闹钟的特权流）；授权后高优先级通知也能一起绕过。

> ⚠️ 移动 OS 不允许「100% 无视一切强制响铃」。我们做到的是
> **授权后以闹钟身份 + 全屏 Activity + 震动 在 DND 下强提醒**，已是允许的最强档。

---

## 七、注意事项
- 改了 `www/` 里的前端后，**务必 `npx cap sync android` 再出包**，否则 APK 还是旧页面。
- 资源统一放在 `www/`，Capacitor 用 `webDir: "www"` 同步进 `android/app/src/main/assets/public`。
- 本沙盒无法编译 APK；原生插件代码（`android/app/.../plugins/`）已在 Android Studio 中按
  Capacitor 6 API 编写，构建时由 Gradle 编译。
- `server.js` 为早期 WebSocket 方案，已废弃（好友叫醒走 Bmob 轮询），仅作历史参考，无需部署。
