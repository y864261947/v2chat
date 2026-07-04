# 前端开发指南（安卓伴侣版）

- 读者：前端 UI 开发者
- 必读上位文档：[android-companion-2dev.md](./android-companion-2dev.md)（产品决策与里程碑）、[backend-api-spec.md](./backend-api-spec.md)（后端协议，登录/积分/语音全在里面）
- 仓库：`github.com/alex-uj/chatbox-companion`（私有）；`upstream` 指向官方 chatboxai/chatbox，仅作 cherry-pick 来源，**日常开发不要 merge 上游**

## 1. 十分钟环境搭建

本项目是 Chatbox（Electron+React）的 fork，安卓端 = 同一套 React renderer + Capacitor 壳。

```bash
# 1. 工具链（Linux 主力机已就绪：~/Android/env.sh；新机器按下列版本装）
#    node 22.x（必须 22，engine-strict 会卡 24）、JDK 21、Android SDK: platform-35 + build-tools;35.0.0
source ~/Android/env.sh

# 2. 依赖
pnpm install        # sharp/zipfile 构建失败可忽略（只影响图标生成/桌面打包）

# 3. 构建安卓包
pnpm run mobile:sync:android                      # 构建 web 资产 + 同步进 android/
(cd android && ./gradlew assembleDebug)           # 产出 android/app/build/outputs/apk/debug/app-debug.apk

# 4. 跑起来
emulator -avd companion &                         # 或真机 USB（开发者模式）
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.danjoy.companion.dev/.MainActivity
```

**日常 UI 迭代不用每次打 APK**：`pnpm run dev:web` 起浏览器版（同一套 renderer，`CHATBOX_BUILD_PLATFORM=web`），UI 布局/组件开发在浏览器里热更完成，涉及原生能力（录音/sqlite/安全区）再上模拟器验证。WebView 里的页面可用 Chrome `chrome://inspect` 远程调试。

## 2. 架构导览（读完再动手）

```
src/
├── renderer/            # 全部 UI 与前端逻辑（三端共享：desktop/web/mobile）
│   ├── platform/        # ★ 平台抽象缝：index.ts 按 CHATBOX_BUILD_TARGET 注入
│   │                    #   MobilePlatform（mobile_platform.ts）= 安卓端系统能力入口
│   ├── routes/          # TanStack Router 文件路由（页面都在这）
│   ├── components/      # 组件；message-parts/ = 消息气泡的分部件渲染
│   ├── stores/          # jotai atoms + zustand（sessionActions/settingsStore/premiumActions）
│   ├── storage/         # 持久层：SQLite*Storage（移动端走 @capacitor-community/sqlite）+ Blob 存储
│   └── packages/        # 领域逻辑：model-calls（AI 调用）、tools（工具调用框架）、remote.ts（官方云 API，改造对象）
├── shared/              # 主进程/renderer 共享
│   ├── types/session.ts # ★ 消息模型：contentParts（text/image/info/reasoning part）
│   ├── providers/definitions/   # ★ 每个 AI 服务商一个定义文件；chatboxai.ts 是"官方云服务"（我们自研服务照它抄）
│   ├── context/builder.ts       # 发给模型前的上下文组装
│   └── request/chatboxai_pool.ts # 官方 API origin（改造对象）
└── main/                # Electron 主进程，安卓端不跑（知识库/RAG 都在这，所以移动端没有向量库）
```

关键规则：

- **平台差异只进 Platform 接口或 `CHATBOX_BUILD_TARGET` 守卫**，不要在业务组件里散落 `if (isAndroid)`
- 消息是 **parts 数组**（`shared/types/session.ts:140` MessageContentPartsSchema，L322-330 各 part 类型）。加新消息形态=加新 part schema + message-parts 渲染组件 + context/builder 的模型侧转换
- UI 栈混用 MUI + Mantine + Tailwind（历史原因），**跟随所改文件的既有风格**
- 移动端存储：结构化数据 → sqlite（参照 `storage/SQLiteSessionMetaStorage.ts`），二进制（录音/表情包图片）→ Blob 存储（`useBlob/setBlob/getBlob`）

## 3. 任务地图

### M1 品牌与痕迹剥离（先做，改动小、熟悉代码库）

| 事项 | 落点 |
|---|---|
| 移除 GA / Plausible / JK 统计、Sentry | `src/renderer/setup/{ga_init,plausible_init,jk_analytics_init,sentry_init}.ts`、`src/renderer/analytics/`；desktop 侧 `src/main/analystic-node.ts` 顺带 |
| 移除评分引导 | `src/renderer/modals/AppStoreRating.tsx` 及调用点 |
| 官方链接/帮助中心/redirect_app | `src/renderer/packages/remote.ts`（搜 `redirect_app`）、Getting Started 引导内容 |
| 更新检查换自建 | `remote.ts:144` `/chatbox_need_update/` → 协议 §7 `/api/app/version`，UI 复用 `stores/updateStore.ts` |
| App 名/图标/启动屏 | `capacitor.config.ts`（appName）、`android/app/src/main/res/`（图标先占位，品牌定稿后 `pnpm run mobile:assets` 生成，需先修 sharp） |
| 包名 | 保持 `com.danjoy.companion.dev` 占位，**首个对外 APK 前**全局替换（build.gradle applicationId + capacitor.config appId） |

验收：APK 抓包无任何 chatboxai.app / GA / Sentry 流量。

### M2 伴侣体验（核心工程）

按依赖顺序：

1. **微信式首页**：`Sidebar.tsx` + `routes/index.tsx` 会话列表 → "联系人"式列表（头像大、显示最后一条消息与时间）。会话与角色绑定后，"新建会话"语义变为"添加角色"
2. **角色系统扩展**：Copilots（`routes/copilots/`、类型在 `shared/types.ts` L90 附近）扩展字段：`voice_id`（TTS 音色）、`sticker_pack_id`（专属表情包）、`memory_enabled`。角色编辑页加对应设置项
3. **语音消息**（最大单项，先动数据模型）：
   - `shared/types/session.ts` 新增 `MessageAudioPartSchema`：`{ type: 'audio', blobKey, durationMs, transcript?: string }`
   - 录音：WebView 内 `MediaRecorder`（需在 `android/` MainActivity 授予 WebView 麦克风权限 + Manifest `RECORD_AUDIO`——原生侧小改，找 Alex/Claude 配合）；InputBox 加按住说话交互
   - 用户侧链路：录音 → blob 存储 → 调协议 §4.2 STT → transcript 填入 part → 气泡渲染（波形/时长，点击播放，长按看文字）
   - AI 侧链路：回复文本 → 协议 §4.3 TTS（voice=角色 voice_id）→ blob → audio part 气泡；设置项控制"语音回复开关"
   - `shared/context/builder.ts`：audio part 以 transcript 文本进入模型上下文
4. **表情包**：
   - 存储：sqlite 表（用户库/角色库、图片 blobKey、`description` 字段）+ 图片进 blob
   - 导入：相册选图 → 调视觉模型生成 description（供 AI 选用）→ 入库；管理页（用户库 + 角色分配）
   - 用户发送：InputBox 加表情 picker → 作为 image part 发送（视觉模型已支持，管线现成）
   - AI 发送：`packages/tools/` 注册 `send_sticker` 工具（参数 sticker_id，enum 限定为该角色库；描述里带各贴纸 description）→ 工具调用结果渲染为表情消息
5. **本地记忆**：
   - 新建 `MemoryController` 接口（放 `platform/` 或独立 `packages/memory/`）：`extract(sessionId)` / `list/search` / `upsert/delete`；本地实现 = sqlite 表 + 用当前对话模型做事实提取（触发：会话空闲/每 N 条消息）
   - 注入：`context/builder.ts` 组装 system prompt 时带入该角色的记忆条目
   - 记忆册页面：`routes/` 新页，按角色分组查看/编辑/删除
   - 接口留好第二实现位（M4 Honcho 云记忆，走后端代理）
6. **登录/卡密/积分 UI**（可与后端联调并行推进）：改造 `premiumActions.ts` + `remote.ts` 为协议 §2；登录页（邮箱+验证码）、我的页面（积分余额、卡密兑换、退出）

### 联调策略

后端就绪前：聊天功能用「自定义提供方」接任意中转站即可全量开发（Chatbox 原生支持）；登录/积分 UI 先对着协议 mock。后端起来后把 `chatboxai_pool.ts` origin 指到测试环境。

## 4. 工程约定

```bash
pnpm run lint / lint:fix     # biome
pnpm run check               # tsc --noEmit（提交前必过）
pnpm test                    # vitest
```

- 提交规范：conventional commits（`feat:` / `fix:` / `chore:`），中文描述 OK
- 分支：短生命周期 feature 分支 → PR 到 `main`，双人互审；不要直接 push main（Alex 的后端协议改动除外）
- 上游锁定在 `baseline-v1.21.1`（tag），需要官方修复找 Alex 评估 cherry-pick

## 5. 已知坑（踩过的都在这）

1. **node 必须 22.x**：`.npmrc` 的 engine-strict + i18next-parser 上限卡死 node 24
2. **sharp 构建失败**：只影响 `mobile:assets` 图标生成；修法=装 libvips 或让 sharp 走预编译（图标阶段再处理）
3. 启动日志有 2 条 sqlite `CloseConnection` 报错：**良性**（先关后开竞态），待修但不阻塞
4. 强杀后冷启动有几秒白屏（初始化中 splash 已隐藏），伴侣化改造时顺手优化 splash 时机
5. git 历史是重建过的无父根（`baseline-v1.21.1` → M0），网上搜到的官方仓库 SHA 在本仓库不存在，属正常
