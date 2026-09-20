# 发布产物（apps/artifacts）

各端编译产物入库归档，随 tag 发布。

| 文件 | 端 | 版本 | 说明 |
|---|---|---|---|
| `shiguang-android-v1.1.2.apk` | Android | v1.1.2 | 原生 WebView 壳（[apps/android](../android)），debug 签名可侧载直装，34KB。v1.1.1 修复 Android 14+ 启动闪退；v1.1.2 产品名更名「拾光」（应用名+断网提示），已在 API 35 模拟器实机验证启动+页面加载 |
| `shiguang-expo-native-v1.1.1.apk` | Android | v1.1.1 | **Expo 原生应用**（[apps/mobile](../mobile)），EAS 云构建（preview/侧载），66MB。原生渲染 UI + SecureStore + 原生录音；JS 层支持 EAS Update OTA 热更。v1.1.0 修复首屏黑屏（双 React 实例崩溃：根 package-lock.json 入库 + metro react 解析回退）；v1.1.1 产品名更名「拾光」。均在 API 35 模拟器验证登录页正常渲染、无 JS 异常 |

## 重建方式

- **WebView 壳 Android**：`cd apps/android && ./gradlew assembleRelease`（产物 `app/build/outputs/apk/release/app-release.apk`）
- **Expo 原生 Android**：`cd apps/mobile && eas build -p android --profile preview`（EAS 云构建，签名自动托管；热更：`eas update -p android` 免重装）
- **iOS**：Windows 无法编译 IPA。两条路径：Capacitor Xcode 工程（[apps/native/ios](../native/ios)，Mac 编译）或 Expo 端 `eas build -p ios`（需 Apple 开发者账号 $99/年）

## 命名规范

`shiguang-<端>-v<版本>.apk|ipa`，版本号与 git tag 一致（当前 `v1.1.0-m1`）。

## 真机验证清单

见 [apps/android/README.md](../android/README.md)（九项：安装启动/登录保持/语音记账/CSV 导入/数据导出/主题记忆/返回键/断网重试/旋转）。
