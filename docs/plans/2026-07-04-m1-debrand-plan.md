# M1 品牌剥离 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 剥离全部第三方遥测与官方 Chatbox 痕迹，产出"零上报、无官方链接"的干净基线 APK。

**Architecture:** 三类改动——①删除副作用初始化（HTML 脚本 + setup/*_init 导入）；②把被全代码库依赖的 Sentry 适配器替换为 no-op（保留调用面，最小 diff）；③摘除官方引导/评分/更新检查/外链的入口点。不动 `routes/guide/`、`settings/provider/chatbox-ai/`、`image-creator/` 内部（它们在 M2 被整体替换，白名单见全局约束）。

**Tech Stack:** React 18 + TanStack Router + biome + vitest；构建验证走 `pnpm run check`。

## Global Constraints

- 环境：`source ~/Android/env.sh`（node 22.x 必须；系统 node 24 会被 engine-strict 拒绝）
- 每个任务结束必须通过：`pnpm run check`（tsc）与 `pnpm run lint`（biome）
- 提交规范：conventional commits，本计划统一 `feat(debrand): ...`
- **白名单（M1 不改其内部）**：`src/renderer/routes/guide/`、`src/renderer/routes/settings/provider/chatbox-ai/`、`src/renderer/routes/image-creator/`——M2.1/M2.6 整体替换；只要它们不再被运行时进入即可
- 不改 `src/main/`（Electron 桌面主进程，安卓不跑），**例外**：`src/main/adapters/sentry.ts` 同步 no-op（保持桌面构建一致）
- 验收总标准：Task 8 的 grep 套件全过 + 模拟器抓不到 googletagmanager / plausible / sentry / chatboxai.app 请求

---

### Task 1: 移除 index.html 统计脚本

**Files:**
- Modify: `src/renderer/index.html:16-42` 附近

**Interfaces:**
- Produces: `window.plausible` 与 `gtag` 全局不复存在（Task 2 删除其唯一 JS 消费方）

- [ ] **Step 1: 删除 gtag + plausible 脚本块**

打开 `src/renderer/index.html`，删除从 `<!-- Google tag (gtag.js) -->` 注释起，到包含 `gtag("js", new Date());` 的内联 `<script>` 的闭合标签 `</script>` 为止的整块（包括 `googletagmanager.com/gtag/js?id=G-B365F44W6E` 外链脚本、`plausible.midway.run/js/script.local.hash.js` 外链脚本、`window.plausible` 队列初始化和 `gtag` 函数定义）。

- [ ] **Step 2: 验证清除干净**

Run: `grep -cE 'googletagmanager|plausible|gtag' src/renderer/index.html`
Expected: `0`

- [ ] **Step 3: 构建冒烟**

Run: `source ~/Android/env.sh && pnpm run check`
Expected: 无 TS 错误（HTML 改动不影响，但作为任务出口习惯）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/index.html
git commit -m "feat(debrand): remove gtag and plausible scripts from index.html"
```

---

### Task 2: 移除遥测初始化模块（GA / Plausible / JK / Sentry init）

**Files:**
- Modify: `src/renderer/index.tsx`（副作用导入区 L26-44、`Sentry.captureException` 调用 L141、`import * as Sentry` L4）
- Delete: `src/renderer/setup/ga_init.ts`、`src/renderer/setup/plausible_init.ts`、`src/renderer/setup/jk_analytics_init.ts`、`src/renderer/setup/sentry_init.ts`

**Interfaces:**
- Consumes: 无
- Produces: `Sentry.init` 不再执行（DSN `sentry.midway.run` 从渲染进程消失）；`@/analytics/jk` 模块保留（社区版已是空壳 no-op，15 个调用点不动）

- [ ] **Step 1: 删除 index.tsx 中的 4 行副作用导入**

在 `src/renderer/index.tsx` 中删除以下 4 行（保留 `./setup/load_polyfill`、`./setup/global_error_handler`、`./setup/protect`）：

```ts
import './setup/sentry_init'
import './setup/ga_init'
import './setup/plausible_init'
import './setup/jk_analytics_init'
```

- [ ] **Step 2: 处理 index.tsx 残留 Sentry 用法**

`src/renderer/index.tsx:141` 附近有：

```ts
    Sentry.captureException(e)
    log.error('initializeApp error', e)
```

删除 `Sentry.captureException(e)` 一行（`log.error` 已足够）。然后：

Run: `grep -n "Sentry" src/renderer/index.tsx`
Expected: 只剩 L4 的 `import * as Sentry from '@sentry/react'` → 把该 import 行也删除。若还有其他 `Sentry.` 调用，同样删除并保留相邻的 `log.error`。

- [ ] **Step 3: 删除 4 个 init 文件**

```bash
git rm src/renderer/setup/sentry_init.ts src/renderer/setup/ga_init.ts src/renderer/setup/plausible_init.ts src/renderer/setup/jk_analytics_init.ts
```

- [ ] **Step 4: 检查 global_error_handler 是否引用 Sentry**

Run: `grep -n "@sentry/react\|Sentry\." src/renderer/setup/global_error_handler.ts src/renderer/components/common/ErrorBoundary.tsx`

若有输出：删除对应 `import`，并把每处 `Sentry.captureException(err)` 替换为（该文件已有 logger 则复用，否则）：

```ts
import { getLogger } from '@/lib/utils'
const log = getLogger('global-error')
// 替换处：
log.error(err)
```

- [ ] **Step 5: 类型与引用验证**

Run: `pnpm run check && grep -rn "setup/ga_init\|setup/plausible_init\|setup/jk_analytics_init\|setup/sentry_init" src/`
Expected: tsc 通过；grep 输出为空

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(debrand): remove GA/Plausible/JK/Sentry init modules"
```

---

### Task 3: Sentry 适配器 no-op 化（保留全代码库调用面）

**Files:**
- Modify: `src/renderer/adapters/sentry.ts`（全文替换）
- Modify: `src/main/adapters/sentry.ts`（同样处理）
- Test: `src/renderer/adapters/index.test.ts`（已存在，跑通即可）

**Interfaces:**
- Consumes: `SentryAdapter`、`SentryScope`（`src/shared/utils/sentry_adapter.ts`，不改）
- Produces: `RendererSentryAdapter` 类名与方法签名**保持不变**（`captureException(error: unknown): void`、`withScope(cb)`），全代码库 ~200 处 `captureException` 调用零改动

- [ ] **Step 1: 全文替换 renderer 适配器**

`src/renderer/adapters/sentry.ts` 整文件替换为：

```ts
import type { SentryAdapter, SentryScope } from '../../shared/utils/sentry_adapter'

/**
 * 零遥测（决策 D14）：Sentry 适配器 no-op 化。
 * 保留类名与接口，调用面不动；错误排查依赖本地日志 + 用户反馈（协议 §6）。
 */
export class RendererSentryAdapter implements SentryAdapter {
  captureException(_error: unknown): void {}

  withScope(callback: (scope: SentryScope) => void): void {
    const scope: SentryScope = {
      setTag(_key: string, _value: string): void {},
      setExtra(_key: string, _value: unknown): void {},
    }
    callback(scope)
  }
}
```

- [ ] **Step 2: 同步处理 main 侧适配器**

Run: `grep -n "export\|implements" src/main/adapters/sentry.ts`

按输出的类名/接口，用与 Step 1 完全相同的模式重写 `src/main/adapters/sentry.ts`（保留导出名，方法体清空；删除 `@sentry/node` import，改为仅 import 共享类型）。

- [ ] **Step 3: 验证**

Run: `pnpm run check && pnpm test -- adapters && grep -rn "sentry.midway.run" src/`
Expected: tsc 通过；adapters 测试通过（若测试断言了真实 Sentry 行为则更新断言为 no-op 行为）；grep 为空

- [ ] **Step 4: Commit**

```bash
git add src/renderer/adapters/sentry.ts src/main/adapters/sentry.ts src/renderer/adapters/index.test.ts
git commit -m "feat(debrand): no-op sentry adapters, keep call surface"
```

---

### Task 4: 移除 App Store 评分弹窗与计数

**Files:**
- Modify: `src/renderer/modals/index.tsx:2,23`
- Modify: `src/renderer/stores/session/pictures.ts:110` 附近
- Modify: `src/renderer/stores/session/orchestration.ts:289` 附近
- Modify: `src/renderer/routes/__root.tsx:345`（已注释的 JSX 残留）
- Delete: `src/renderer/modals/AppStoreRating.tsx`、`src/renderer/packages/apple_app_store.ts`

**Interfaces:**
- Produces: NiceModal 注册表不再含 `app-store-rating`；`apple_app_store` 模块消失

- [ ] **Step 1: 摘除注册**

`src/renderer/modals/index.tsx` 删除两行：

```ts
import AppStoreRating from './AppStoreRating'
```

```ts
NiceModal.register('app-store-rating', AppStoreRating)
```

- [ ] **Step 2: 摘除计数调用**

Run: `grep -n "apple_app_store\|tickAfterMessageGenerated" src/renderer/stores/session/pictures.ts src/renderer/stores/session/orchestration.ts`

按输出，在两个文件中各删除 `appleAppStore.tickAfterMessageGenerated()` 调用行及文件顶部对应的 `import * as appleAppStore from ...`（或同义）导入行。

- [ ] **Step 3: 清理 __root.tsx 注释残留**

删除 `src/renderer/routes/__root.tsx:345` 的 `{/* <AppStoreRatingDialog /> */}`；随后 `grep -n "AppStoreRating" src/renderer/routes/__root.tsx`，若有 import 一并删除。

- [ ] **Step 4: 删除文件**

```bash
git rm src/renderer/modals/AppStoreRating.tsx src/renderer/packages/apple_app_store.ts
```

- [ ] **Step 5: 验证**

Run: `pnpm run check && grep -rn "AppStoreRating\|apple_app_store" src/renderer`
Expected: tsc 通过；grep 为空

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(debrand): remove app store rating dialog and counters"
```

---

### Task 5: 停用官方更新检查

**Files:**
- Modify: `src/renderer/hooks/useVersion.ts:56`

**Interfaces:**
- Consumes: 无（`remote.checkNeedUpdate` 变为死代码，随 M2.6 重写 remote.ts 时移除）
- Produces: `needUpdate` 恒为 `false`；UI 的 UpdateSection 显示"已是最新"且不发任何网络请求

- [ ] **Step 1: 替换检查调用**

`src/renderer/hooks/useVersion.ts:56`，将：

```ts
        const needUpdate = await remote.checkNeedUpdate(version, os, config, settings)
```

替换为：

```ts
        // M1 停用官方更新检查；M3 联调时接自研 /api/app/version（docs/plans/backend-api-spec.md §7）
        const needUpdate = false
```

- [ ] **Step 2: 清理未用变量与导入**

Run: `pnpm run lint`
Expected: biome 报出 `useVersion.ts` 中因此未使用的变量/导入（如 `os`、`config`、`settings`、`remote`）。仅当 biome 确认未用时删除对应行；`remote` 若在该文件其他处仍被使用则保留。

- [ ] **Step 3: 验证**

Run: `pnpm run check && grep -rn "chatbox_need_update" src/renderer --include='*.ts*' | grep -v "packages/remote.ts"`
Expected: tsc 通过；grep 为空（定义处保留，调用处清零）

- [ ] **Step 4: Commit**

```bash
git add src/renderer/hooks/useVersion.ts
git commit -m "feat(debrand): disable official update check, stub for /api/app/version"
```

---

### Task 6: 停用 Getting Started 官方引导（首启直达主页）

**Files:**
- Modify: `src/renderer/routes/__root.tsx:182-191`

**Interfaces:**
- Produces: 新用户首启不再进入 `/guide`（该目录成为死路由，M2.1 用「创建第一个角色」引导整体替换并删除）

- [ ] **Step 1: 删除自动跳转块**

`src/renderer/routes/__root.tsx` 中删除以下整块（L182-191）：

```ts
      // Check if user needs onboarding guide
      // Conditions: not completed onboarding AND no valid config
      const onboardingCompleted = onboardingStore.getState().completed
      const needsSetup = settingActions.needEditSetting()

      // Auto-navigate to guide for new users who need setup
      if (!isExceeded && !onboardingCompleted && needsSetup) {
        router.navigate({ to: '/guide', replace: true })
        return
      }
```

原位置留一行注释：

```ts
      // M1: 官方引导已停用；M2.1 替换为「创建第一个角色」引导（companion-feature-spec.md §2）
```

- [ ] **Step 2: 清理未用导入**

Run: `pnpm run lint`
Expected: 若 `onboardingStore` / `settingActions` 在该文件无其他使用，biome 会报未用导入——按报告删除；有其他使用则保留。

- [ ] **Step 3: 首启行为验证**

Run: `pnpm run dev:web`，浏览器打开后在 DevTools Console 执行 `localStorage.clear(); indexedDB.databases().then(dbs=>dbs.forEach(d=>indexedDB.deleteDatabase(d.name))); location.reload()`
Expected: 刷新后落在主界面（会话列表/空会话），**不**出现 Boxy Getting Started 页

- [ ] **Step 4: Commit**

```bash
git add src/renderer/routes/__root.tsx
git commit -m "feat(debrand): disable official onboarding guide auto-navigation"
```

---

### Task 7: about 页官方链接与社媒清理

**Files:**
- Modify: `src/renderer/routes/about.tsx:71-148`

**Interfaces:**
- Produces: about 页只保留 图标 + 版本 + UpdateSection + slogan；全部官方外链（privacy/terms/github/小红书/微信/官网/问卷/反馈/changelog/邮箱/FAQ）移除

- [ ] **Step 1: 删除隐私/条款锚点块**

删除 L71-90 的 `<Flex gap="sm">…</Flex>` 整块（两个指向 `chatboxai.app/privacy`、`chatboxai.app/terms` 的 `<Anchor>`）。自有《隐私政策》《用户协议》页面上线后再以自有 URL 重加（记入 M3 收口清单）。

- [ ] **Step 2: 删除两个 List 区块**

删除 L94-114（Github/RedNote/WeChat 社媒 List）与 L116-148（官网/问卷/反馈/Changelog/邮箱/FAQ List）两个 `<List>…</List>` 整块。

- [ ] **Step 3: 清理未用导入**

Run: `pnpm run lint`
Expected: biome 报出未用的 `BrandGithub`、`BrandRedNote`、`BrandWechat`、`WechatQRCode`、`IconHome`、`IconClipboard`、`IconPencil`、`IconFileText`、`IconMail`、`IconMessage2`、`ListItem`、`List`、`buildChatboxUrl` 等——按报告逐一删除（以 biome 实际报告为准）。

- [ ] **Step 4: 视觉验证**

Run: `pnpm run dev:web` → 左下角/设置进入「关于」页
Expected: 仅剩应用图标、`Chatbox (v0.0.1)` 标题、检查更新区（显示已是最新）、slogan 两行文案；无任何可点外链。（标题/slogan 仍是 Chatbox 文案——全量文案与图标替换等品牌名定稿，见总计划 D17，不在本任务）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/routes/about.tsx
git commit -m "feat(debrand): strip official links and socials from about page"
```

---

### Task 8: 全量验证与残留清扫

**Files:**
- Test: 全仓 grep 套件 + 构建 + 模拟器网络抽查

**Interfaces:**
- Consumes: Task 1-7 全部完成
- Produces: M1 验收结论（记录到 PR 描述）

- [ ] **Step 1: grep 套件**

依次运行，逐条核对期望值：

```bash
grep -rn "googletagmanager\|plausible" src/ --include='*.ts' --include='*.tsx' --include='*.html'   # 期望：空
grep -rn "sentry.midway.run" src/                                                                     # 期望：空
grep -rn "AppStoreRating\|apple_app_store" src/renderer                                               # 期望：空
grep -rn "chatbox_need_update" src/renderer | grep -v "packages/remote.ts"                            # 期望：空
grep -rln "buildChatboxUrl\|chatboxai.app" src/renderer --include='*.tsx' \
  | grep -v "routes/guide/\|routes/settings/provider/chatbox-ai/\|routes/image-creator/"              # 期望：空（白名单外零引用）
```

任何一条不为空：该文件属白名单则放行并在 PR 里注明；否则回到对应任务补漏。

- [ ] **Step 2: 静态与单测**

Run: `pnpm run check && pnpm run lint && pnpm test`
Expected: 全部通过

- [ ] **Step 3: 打包装机**

```bash
source ~/Android/env.sh
pnpm run mobile:sync:android
(cd android && ./gradlew assembleDebug)
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.danjoy.companion.dev/.MainActivity
```

Expected: 安装启动正常，首启直达主界面（无 Getting Started）

- [ ] **Step 4: 运行时网络抽查**

桌面 Chrome 打开 `chrome://inspect` → 选中设备上的 WebView → Network 面板；在 App 里完成「浏览会话 → 打开关于页 → 发一条消息（自定义 provider）」
Expected: 请求列表中**不出现** `googletagmanager.com`、`plausible.midway.run`、`sentry.midway.run`、`api.chatboxai.app`、`chatboxai.app` 任何域名（自定义 provider 的域名除外）

- [ ] **Step 5: 收尾提交（如有残留修复）**

```bash
git add -A && git commit -m "feat(debrand): final sweep per M1 verification suite"
```
