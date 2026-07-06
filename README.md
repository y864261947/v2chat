# V2Chat

V2Chat 是一个基于 Chatbox Community Edition 改造的 V2API 专属 AI 聊天客户端。当前版本面向 Android APK 打包和本地开发，默认接入 V2API：

- 固定 API Base URL：`https://v2api.top/v1`
- 用户只需要在应用内填写 V2API API Key
- 支持 OpenAI / Claude / Gemini 三种协议模型配置
- 支持文本聊天、图片发送与识别
- 支持在用户明确要求语音回复时生成可播放语音条

## 目录结构

- `src/renderer`：前端界面、设置页、聊天渲染、移动端 WebView 页面
- `src/shared`：模型 provider、类型、默认配置、V2API 公共逻辑
- `src/main`：Electron 主进程与部分桌面/本地能力
- `android`：Capacitor Android 工程，用于生成 APK
- `capacitor.config.ts`：移动端应用配置

## 环境要求

建议使用 Windows 进行 Android 打包。本项目当前验证过的环境：

- Node.js：`22.x`，要求 `>=22.12.0 <25.0.0`
- pnpm：`10.x`，项目锁定 `pnpm@10.33.0`
- JDK：`21`
- Android SDK：需要 Android SDK Platform、Build Tools、Platform Tools、Command-line Tools
- Git

如果使用 Android Studio，可以通过 SDK Manager 安装：

- Android SDK Platform
- Android SDK Build-Tools
- Android SDK Command-line Tools
- Android SDK Platform-Tools

## 首次拉取与安装依赖

```powershell
git clone https://github.com/y864261947/v2chat.git
cd v2chat

corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install
```

## Windows 环境变量示例

请按自己的安装路径调整。下面是 PowerShell 示例：

```powershell
$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT="$env:LOCALAPPDATA\Android\Sdk"
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

检查环境：

```powershell
node -v
pnpm -v
java -version
adb version
```

## 本地开发

桌面开发模式：

```powershell
pnpm dev
```

Web 构建预览：

```powershell
pnpm run build:web
pnpm run serve:web
```

类型检查：

```powershell
pnpm run check
```

## 打包 Android APK

先构建前端并同步到 Android 工程：

```powershell
pnpm run mobile:sync:android
```

再进入 Android 工程生成 debug APK：

```powershell
cd android
.\gradlew.bat assembleDebug
```

生成文件位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

这个 APK 是 debug 签名包，可以直接发送到 Android 手机安装测试。正式发布前需要配置 release 签名并执行 release 打包流程。

## 一键打包命令示例

在项目根目录执行：

```powershell
pnpm run mobile:sync:android
cd android
.\gradlew.bat assembleDebug
```

## 常见问题

### pnpm 命令不可用

先启用 Corepack：

```powershell
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

### Gradle 找不到 JDK

确认 `JAVA_HOME` 指向 JDK 21，并且 `java -version` 输出为 21。

### 找不到 Android SDK

确认 `ANDROID_HOME` 和 `ANDROID_SDK_ROOT` 指向 Android SDK 目录，例如：

```powershell
$env:LOCALAPPDATA\Android\Sdk
```

### mobile:sync:android 构建时间很长

首次构建会下载依赖和生成大量前端产物，可能需要几分钟。后续构建会使用缓存，速度会快一些。

### 构建时出现 chunk size、eval、flatDir warning

这些是当前依赖和构建配置产生的 warning，不影响 debug APK 生成。只要命令最终显示 `BUILD SUCCESSFUL`，APK 就已经生成。

## 应用内配置

安装后打开 V2Chat：

1. 进入设置里的 `V2API`
2. 填写 V2API API Key
3. 选择协议：OpenAI、Claude 或 Gemini
4. 刷新模型列表，选择默认聊天模型、视觉模型和 TTS 配置
5. 回到聊天页面开始使用

## 当前验证命令

当前改造版本已验证：

```powershell
pnpm run check
pnpm run mobile:sync:android
cd android
.\gradlew.bat assembleDebug
```

最终 APK 输出路径：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```
