# 发布产物（apps/artifacts）

各端编译产物入库归档，随 tag 发布。

| 文件 | 端 | 版本 | 说明 |
|---|---|---|---|
| `shiguang-android-v1.1.0.apk` | Android | v1.1.0-m1 | 原生 WebView 壳（[apps/android](../android)），debug 签名可侧载直装，33KB |

## 重建方式

- **Android**：`cd apps/android && ./gradlew assembleRelease`（产物 `app/build/outputs/apk/release/app-release.apk`）
- **iOS**：Windows 无法编译 IPA；Xcode 工程在 [apps/native/ios](../native/ios)（Capacitor remote 模式），需 Mac + Apple 开发者账号，步骤见 [apps/native/README](../native/README.md)

## 命名规范

`shiguang-<端>-v<版本>.apk|ipa`，版本号与 git tag 一致（当前 `v1.1.0-m1`）。

## 真机验证清单

见 [apps/android/README.md](../android/README.md)（九项：安装启动/登录保持/语音记账/CSV 导入/数据导出/主题记忆/返回键/断网重试/旋转）。
