# V2Chat Android Client

V2Chat 是面向角色扮演用户的 Android AI 客户端。默认使用 V2Chat 账号与积分钱包，通过独立 `v2chat-server` 调用 NewApi 和媒体服务；高级设置仍可切换为本机 BYOK。正式客户端不包含任何供应商密钥。

## 目录

- `src/renderer`：React UI、聊天、角色、账号、积分、备份和更新状态
- `src/shared`：消息类型、Provider 和 V2API 公共配置
- `android`：Capacitor Android 工程与 V2Chat 原生插件
- `scripts/generate-android-release-keystore.ps1`：首次生成正式签名
- 同级目录 `../v2chat-server`：独立商业服务

## 开发环境

- Windows 10/11
- Node.js `>=22.12 <26`
- pnpm `10.17.0`
- JDK 21
- Android SDK Platform 35、Build Tools、Platform Tools、Command-line Tools
- Go 1.25+（仅运行后端时需要）

```powershell
corepack enable
corepack pnpm@10.17.0 install

$env:JAVA_HOME="C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
$env:Path="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:Path"
```

检查环境：

```powershell
node -v
corepack pnpm@10.17.0 -v
java -version
adb version
```

`zipfile` 是上游 EPUB 功能的可选旧原生模块，本项目不会在安装阶段编译它，不需要额外安装 Python。

## 本地运行

先启动业务服务：

```powershell
cd ..\v2chat-server
go run .\cmd\server
```

再启动客户端预览：

```powershell
cd ..\chatbox-companion
corepack pnpm@10.17.0 dev:web
```

本地网页会自动使用 `http://127.0.0.1:8080/v1`；正式构建使用 `https://chat.v2api.top/v1`。常用检查：

```powershell
corepack pnpm@10.17.0 run check
corepack pnpm@10.17.0 test
corepack pnpm@10.17.0 run build:web
```

## Android Debug APK

```powershell
corepack pnpm@10.17.0 run mobile:sync:android
cd android
.\gradlew.bat assembleProductionDebug
```

产物：

```text
android/app/build/outputs/apk/production/debug/app-production-debug.apk
```

正式包名是 `top.v2api.v2chat`。

## 旧测试包迁移

旧测试包名为 `com.danjoy.companion.dev`，不能直接升级为正式包。迁移步骤：

1. 构建并安装 `legacyDebug`。它沿用本机 Android debug 签名，可覆盖此前由同一台开发机生成的测试 APK。
2. 在“设置 → 账号与积分 → 本地加密备份”点击“导出备份”，设置备份密码。
3. 安装正式 `productionRelease`，两种包可暂时共存。
4. 在正式包点击“本地恢复”，选择 `.v2backup` 并输入同一密码。
5. 确认角色、聊天、图片、语音、背景和附件完整后，再卸载旧测试包。

```powershell
cd android
.\gradlew.bat assembleLegacyDebug
```

迁移产物：

```text
android/app/build/outputs/apk/legacy/debug/app-legacy-debug.apk
```

## 正式签名

只在项目第一次发布时执行一次：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-android-release-keystore.ps1
```

脚本会在 `../release-secrets` 生成加密 PKCS12 keystore 和凭据说明，并在 `android/keystore.properties` 写入本机配置。两处均被 Git 忽略。必须把 `release-secrets` 保存到至少两份加密离线介质；丢失后无法覆盖升级已安装的正式 APK。脚本拒绝覆盖已有签名。

本工作区已经生成正式签名，不要再次运行脚本生成新身份。

## 正式 Release APK

每次发布必须递增 `V2CHAT_VERSION_CODE`，并设置用户可见版本名：

```powershell
$env:V2CHAT_VERSION_CODE="2"
$env:V2CHAT_VERSION_NAME="0.1.0"

corepack pnpm@10.17.0 run mobile:sync:android
cd android
.\gradlew.bat clean assembleProductionRelease
```

产物：

```text
android/app/build/outputs/apk/production/release/app-production-release.apk
```

发布前校验：

```powershell
apksigner verify --verbose .\app\build\outputs\apk\production\release\app-production-release.apk
Get-FileHash .\app\build\outputs\apk\production\release\app-production-release.apk -Algorithm SHA256
```

## 应用内更新清单

APK 上传到 HTTPS 下载地址后，使用离线 Ed25519 私钥签名清单：

```powershell
cd ..\..\v2chat-server
go run .\cmd\releasectl sign `
  --private D:\vibecoding\chatbox\release-secrets\v2chat-release-ed25519.private `
  --version-code 2 `
  --version-name 0.1.0 `
  --minimum-version-code 1 `
  --rollout 10 `
  --apk-url https://download.v2api.top/v2chat/V2Chat-0.1.0.apk `
  --sha256 <APK_SHA256> `
  --size <APK_BYTES>
```

把输出的 `manifest_signature` 与完全相同的字段填入运营后台。APK 会同时验证清单 Ed25519 签名、下载大小和 APK SHA-256，然后才打开 Android 系统安装确认页。`--force` 只用于安全修复或最低版本淘汰。

## 安全发布清单

- `go test ./...`、`pnpm run check`、`pnpm test` 全部通过
- `assembleProductionRelease` 使用既有正式 keystore
- APK 字符串扫描不存在 `sk-`、`sk_`、`gsk_` 等真实供应商密钥
- `versionCode` 高于所有已发布版本
- 真机验证游客、邮箱、积分、图片、录音、TTS、音色、备份恢复和强制更新
- 先 5% 灰度，观察错误率、支付差异和上游成功率，再逐步放量
