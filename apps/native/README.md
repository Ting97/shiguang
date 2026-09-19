# @shiguangri/native —— Capacitor 壳（iOS）

Android 不走本工程（用 [apps/android](../android) 原生 WebView 壳，已含麦克风/文件选择/下载/断网全部兼容点，APK 见 [apps/artifacts](../artifacts)）。本工程服务于 **iOS**：Windows 上生成 Xcode 工程，需在 Mac 上编译。

## 架构

`server.url` 远程加载模式：WebView 直接加载 `https://shiguang.ting97.cn`——页面与 API 同源，cookie 认证零改造，网站更新即时生效。`allowNavigation` 白名单使 Capacitor 原生桥注入线上页面（后续可加本地通知等插件做"渐进增强"）。

## 在 Mac 上出包

```bash
npm install                # 仓库根目录
cd apps/native
npx cap add ios            # 首次：生成 ios/ 工程（本仓库已含则跳过）
npx cap open ios           # Xcode 打开 → 真机/模拟器 Run → Product > Archive
```

- 签名需 Apple Developer 账号（$99/年）；Xcode 内选团队自动管理签名
- 麦克风权限文案已写入 Info.plist（语音记账需要）
- 上架注意 Apple 4.2 最低功能性：建议先加本地通知/分享等原生能力再提审（见 docs/14）

## 已配置

- `capacitor.config.ts`：appId `cn.ting97.shiguang`、server.url 远程加载、allowNavigation 白名单、深色底色
- `ios/App/App/Info.plist`：`NSMicrophoneUsageDescription`（语音记账）、`NSAppTransportSecurity` 不允许明文
- 深色启动底色与网页主题一致（#020617）
