# 拾光 · Android 壳（WebView）

将线上 `https://shiguang.ting97.cn` 打包成安卓 APK 的**原生 WebView 壳**：单 Activity 纯 Java、零第三方依赖、APK 仅 34KB。Web 端与服务端**零改动**。

## 为什么是 WebView 壳

本项目是 Next.js 全栈应用（43 个 API + PostgreSQL + 智谱 AI），无法离线静态化，APK 只能作为在线客户端壳。

| 备选路线 | 结论 |
|---|---|
| 原生 WebView 壳（本方案） | ✅ 零依赖、麦克风/文件/下载完全可控、服务端不改 |
| TWA（Bubblewrap） | ❌ 需给网站加 PWA manifest + assetlinks.json，麦克风授权走 Chrome 弹窗，依赖设备 Chrome |
| Capacitor `server.url` | ❌ 官方仅限开发热更用途，远程页面注入不了原生桥，插件全部失效 |

## 构建

```bash
cd apps/android
./gradlew assembleRelease        # 产物: app/build/outputs/apk/release/app-release.apk
```

- 要求：JDK 17+（本机 JAVA_HOME=temurin-21）、Android SDK（compileSdk 36 / build-tools 36）
- **国内网络注意**：`gradlew` 首次需联网下载 Gradle 发行版与 AGP 依赖，若 `services.gradle.org` 超时，可改用本机 Gradle 直接构建：`D:\gardle\gradle-8.13\bin\gradle assembleRelease`（发行版已在 `~/.gradle` 缓存时 `gradlew` 不会再下载）
- 当前 release 用 **debug 签名**（仅侧载分发）。正式发布/上架前需换自有 keystore（`app/build.gradle` 的 `signingConfig`）
- 图标位图由 [tools/gen_icons.py](tools/gen_icons.py) 纯 Python 生成（零依赖），矢量图标在 `res/drawable/ic_launcher_foreground.xml`

## 兼容点实现对照

| 兼容点 | 网页端依据 | 壳内实现（MainActivity.java） |
|---|---|---|
| 麦克风录音链 | `voice-button.tsx`：getUserMedia + MediaRecorder + AudioContext 重采样 WAV | `RECORD_AUDIO` 运行时权限 + `onPermissionRequest` 仅授权音频采集；webm/opus WebView 原生支持，前端逻辑不动 |
| Cookie 会话 | HttpOnly `shiguang_session` | CookieManager 默认持久化，`onPause` 时 `flush()` 落盘 |
| CSV 账单导入 | `bill-import.tsx` `<input type="file">` | `onShowFileChooser` + `ACTION_GET_CONTENT`（mime 放宽到 `*/*`，支付宝/微信 CSV 常被识别为 excel/plain） |
| 数据导出 | profile 页 `<a href="/api/export">` 直链 | `setDownloadListener` → 系统 `DownloadManager`，透传 Cookie，下载完成 Toast 提示 |
| localStorage 主题 | `shiguang_theme` 等键 | `setDomStorageEnabled(true)` |
| 返回键 / 离线 | — | 返回键：`canGoBack ? goBack : 双击退出`；断网：原生重试浮层（非 assets 页面，避开 file:// 跳转 https 的坑） |

其他处理：站内导航留壳内、外链/tel:/mailto: 跳系统应用；`configChanges` 防旋转重建打断录音；渲染进程崩溃自动重建 WebView；`fitsSystemWindows` 让位系统栏（此时页面 safe-area 取值为 0，与网页 CSS 不冲突）。

## 真机验证清单（首次安装后逐项过）

- [ ] 安装并启动：图标/名称正确，深色启动底色，加载出首页
- [ ] 登录：登录后**杀进程重开**，会话保持不掉线
- [ ] 语音记账：首次点击弹麦克风授权 → 允许 → 录音 → ASR 返回文字入输入框；拒绝授权后再点有 Toast 提示
- [ ] 账单导入：财务页选择 CSV → 系统文件选择器弹出 → 选中后解析入库
- [ ] 数据导出：profile 页导出 JSON/MD → 系统下载，通知栏可见，文件在 Download 目录
- [ ] 主题切换 + 重启 App：localStorage 记忆生效
- [ ] 返回键：页间后退正常；主页面双击退出
- [ ] 断网：打开 App 出现重试浮层，恢复网络后点「重新加载」恢复
- [ ] 旋转屏幕：页面不重载（录音中旋转不中断）

## 已知限制

- 在线应用：无网不可用（有原生断网提示页）
- 版本随网站实时更新，壳仅在 BASE_URL 或原生行为变化时需发新版
- 未申请 `WRITE_EXTERNAL_STORAGE`：下载走 DownloadManager（自带通知与权限豁免），无需存储权限
