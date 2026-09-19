# @shiguangri/mobile —— Expo 原生移动端（方案 B）

原生体验的独立 App：登录（Bearer + SecureStore）→ 动态流 → 语音/文字速记（录音 16kHz WAV → `/api/asr` → `/api/parse`，识别产物自动上墙）。UI 为原生渲染（非 WebView）。

## 已实现

- 登录：手机号+密码，token 存 **SecureStore**，所有请求带 `Authorization: Bearer`（依赖 M0 的双通道认证 + CORS）
- 动态流：FlatList 渲染原文/心情/识别产物计数（日程/待办/收支），401 自动登出
- 速记：文字直发；语音 `expo-av` 录 16kHz 单声道 PCM WAV（GLM-ASR 全平台稳）→ ASR → parse
- 配额提示：额度用尽时展示后端 402 返回的信息

## 出包（EAS 云构建，无需本地 Mac/Gradle 环境）

```bash
npm i -g eas-cli && eas login        # Expo 账号（免费注册）
cd apps/mobile
eas build -p android --profile preview   # 产出 APK（侧载分发）
eas build -p android --profile production # 产出 AAB（商店）
eas build -p ios                     # iOS IPA（需 Apple 开发者账号，可在 eas.json 配凭证）
```

## 本地开发

```bash
cd apps/mobile
npx expo start            # Expo Go 扫码即用（手机与电脑同网）
```

## monorepo 说明

本仓库是 npm workspaces，已按 Expo 官方 monorepo 规范配置：

- `metro.config.js`：watchFolders + 两级 node_modules 解析
- `react-native.config.js`：钉住 android sourceDir
- Windows 本地 `gradle assembleRelease` 已验证原生层可构建；JS 打包环节在 Windows + monorepo 组合下存在 Expo CLI 项目根解析问题（`Unable to resolve module ./index.js`），EAS 云构建（Linux）按官方支持路径不受影响——这也是推荐 EAS 的原因
