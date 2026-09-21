# 发布产物（apps/artifacts）

各端编译产物入库归档，随 tag 发布。

| 文件 | 端 | 版本 | 说明 |
|---|---|---|---|
| `shiguang-android-v1.1.3.apk` | Android | v1.1.3 | 原生 WebView 壳（[apps/android](../android)），debug 签名可侧载直装。v1.1.1 修复启动闪退；v1.1.2 更名「拾光」；v1.1.3 全新品牌图标「拾起一束光」（自适应图标），已在 API 35 模拟器验证启动器图标+页面加载 |
| `shiguang-expo-native-v1.1.3.apk` | Android | v1.1.3 | **Expo 原生应用**（[apps/mobile](../mobile)），EAS 云构建（preview/侧载），110MB。原生渲染 UI + SecureStore + 原生录音；JS 层支持 EAS Update OTA 热更。v1.1.0 修复首屏黑屏；v1.1.1 更名；v1.1.2 品牌图标；**v1.1.3 发布交互改版（底部中央悬浮圆圈：点按=文字/长按=语音 30s）+ 视觉完全体（极光背景/毛玻璃/弹性动效/声波/触觉/下拉刷新/骨架屏）+ 语音格式修复（Android AAC→服务端 ffmpeg 转码）**，已在 API 35 模拟器验证双主题视觉与手势全链路 |
| `shiguang-expo-native-v1.1.2.apk` | Android | v1.1.2 | 上一代 UI（旧版底部 composer + 点按切换录音），已被 v1.1.3 取代 |

## 重建方式

- **WebView 壳 Android**：`cd apps/android && ./gradlew assembleRelease`（产物 `app/build/outputs/apk/release/app-release.apk`）
- **Expo 原生 Android**：`cd apps/mobile && eas build -p android --profile preview`（EAS 云构建，签名自动托管；热更：`eas update -p android` 免重装）
- **iOS**：Windows 无法编译 IPA。两条路径：Capacitor Xcode 工程（[apps/native/ios](../native/ios)，Mac 编译）或 Expo 端 `eas build -p ios`（需 Apple 开发者账号 $99/年）

## 命名规范

`shiguang-<端>-v<版本>.apk|ipa`，版本号与 git tag 一致（当前 `v1.1.0-m1`）。

## 真机验证清单

见 [apps/android/README.md](../android/README.md)（九项：安装启动/登录保持/语音记账/CSV 导入/数据导出/主题记忆/返回键/断网重试/旋转）。
