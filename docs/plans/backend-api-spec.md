# 后端 API 协议规范

- 版本：**v0.1 草案**（后端与前端双方评审后升 v1.0 定稿；定稿后改动需双方确认）
- 读者：后端开发者（实现方）、前端开发者（对接方）
- 上位文档：[android-companion-2dev.md](./android-companion-2dev.md)（决策 D4–D7、D9、D10、D14）

## 0. 设计原则

1. **推理面 OpenAI 兼容**：`/v1/*` 端点与 OpenAI API 语义一致。后端可以自研，也可以直接在 one-api/new-api 这类开源网关前加一层账号服务改造而成。官方 Chatbox 云服务同样是这个形态（`api.chatboxai.app/gateway/openai/v1/...`），客户端已有全部对接代码。
2. **单 token 认证**：用户登录后获得一个 token，同时用于账号面（`/api/*`）和推理面（`/v1/*`）。默认服务的用户**不需要**自己填 API key。
3. **积分计量**：一切消耗（对话 token、语音秒数、合成字符）折算积分，按模型/服务单价扣减。
4. **向后扩展**：Honcho 记忆代理、个人数据源只占坑不实现，避免 v1.0 后返工。

## 1. 通用约定

| 项 | 约定 |
|---|---|
| Base URL | `https://api.<正式域名待定>`；客户端侧可配置（开发期指向测试环境） |
| 认证 | `Authorization: Bearer <token>`，除 §2 登录端点外全部必带 |
| 请求头 | 客户端上报 `X-App-Version: <semver>`、`X-Client-Platform: android\|ios\|web\|desktop` |
| 错误格式 | OpenAI 风格：`{"error": {"code": "<机器码>", "message": "<人读信息>", "type": "<分类>"}}`，HTTP 状态码语义正确 |
| 限流 | 超限返回 `429` + `Retry-After` 头 |
| 时间 | 一律 ISO 8601 UTC 字符串 |
| 金额/积分 | 整数积分（credit），不出现浮点货币 |

## 2. 认证与账号（/api/auth, /api/me）

### 2.1 请求邮箱验证码

```
POST /api/auth/email-code
{ "email": "user@example.com" }
→ 202 {}
```

- 限流：同邮箱 60s 一次、每小时 ≤5 次、每天 ≤20 次（`429 rate_limited`）
- 验证码 6 位数字，10 分钟有效，一次性

### 2.2 验证码登录

```
POST /api/auth/login
{ "email": "user@example.com", "code": "123456" }
→ 200 { "token": "cbk-xxxxxxxx", "user": { ...同 /api/me... } }
```

- 错误：`401 invalid_code`（错误/过期统一此码，避免枚举）
- token：不透明字符串，服务端可吊销；有效期 90 天滑动续期（每次使用刷新）。前缀建议 `cbk-` 便于日志识别
- 邮箱不存在则**静默注册**（首次登录即建号），注册可附赠免费积分（数额后端配置，客户端不硬编码）

### 2.3 登出 / 用户信息

```
POST /api/auth/logout → 204            # 吊销当前 token
GET  /api/me
→ 200 {
  "id": "u_xxx", "email": "user@example.com",
  "credits": 12500,
  "created_at": "2026-07-04T12:00:00Z"
}
```

- `401 invalid_token` / `401 token_expired`：客户端收到即登出回到登录页

### 2.4 卡密兑换

```
POST /api/redeem
{ "code": "XXXX-XXXX-XXXX-XXXX" }
→ 200 { "credits_added": 10000, "credits": 22500 }
```

- 错误：`404 invalid_redeem_code`、`409 redeem_code_used`
- 限流：每用户每小时 ≤10 次（防爆破）

## 3. 模型目录与定价（/api/models）

```
GET /api/models
→ 200 { "models": [ {
    "id": "deepseek-chat",            # 传给 /v1/chat/completions 的 model
    "display_name": "DeepSeek V3",
    "group": "文本对话",               # 客户端分组展示
    "context_window": 65536,
    "capabilities": { "vision": false, "tools": true },
    "price": { "input_per_1k": 2, "output_per_1k": 8, "unit": "credits" }
} ], "voice_price": { "stt_per_minute": 10, "tts_per_1k_chars": 15 } }
```

- 客户端每次冷启动 + 每 6h 拉取缓存；模型上下架完全由后端控制
- `/v1/models`（OpenAI 兼容裸列表）如网关自带则保留，客户端不依赖

## 4. 推理面（/v1，OpenAI 兼容）

### 4.1 对话

```
POST /v1/chat/completions
```

- 完整支持：`stream: true`（SSE）、`messages` 多模态（`image_url` 含 base64 data URL——表情包/图片理解用）、`tools` / `tool_choice`（send_sticker 等客户端工具）
- SSE 末尾必须带 usage 帧（`stream_options: {"include_usage": true}` 语义，直接默认开启）
- 计费：按 usage 的 prompt/completion tokens × 模型单价，会话结束时结算；流中断按已产出结算
- 错误：`402 insufficient_credits`（余额不足，预检 or 结算时），`404 model_not_found`

### 4.2 语音识别（STT）

```
POST /v1/audio/transcriptions   (multipart/form-data)
  file: <audio: aac/m4a/mp3/wav/ogg, ≤25MB, ≤10min>
  model: "whisper-1"             # 兼容占位，后端映射实际引擎
  language: "zh" (可选)
→ 200 { "text": "识别结果" }
```

- 计费：按音频时长向上取整到秒 × 单价
- 客户端录音格式：Android WebView MediaRecorder 产出 `audio/webm;codecs=opus` 或 aac——**后端需支持 webm/opus 输入**（或前端转码，联调时定，倾向后端支持）

### 4.3 语音合成（TTS）

```
POST /v1/audio/speech
{ "model": "tts-default", "voice": "<voice_id 或内置音色名>",
  "input": "要朗读的文本 ≤4000字", "response_format": "mp3" }
→ 200 audio bytes (Content-Type: audio/mpeg)
```

- `voice` 取值：内置音色（后端预置若干中文音色，`/api/models` 附带清单或另设 `/api/voices/presets`）或用户克隆音色 `voice_id`
- 错误：`404 voice_not_found`、`403 voice_not_owned`
- 计费：按 input 字符数

## 5. 音色克隆（/api/voices）

```
POST /api/voices   (multipart/form-data)
  name: "她的声音"
  sample: <audio 10s–60s, ≤10MB>
  consent: "true"                # 必填，见合规
→ 201 { "voice_id": "v_xxx", "status": "processing" | "ready" }

GET    /api/voices          → { "voices": [{ "voice_id", "name", "status", "created_at" }] }
GET    /api/voices/{id}     → 单个状态（客户端在 processing 时轮询，间隔 ≥3s）
DELETE /api/voices/{id}     → 204（同时应删除供应商侧资源）
```

- 配额：每用户 10 个（`403 voice_quota_exceeded`）
- 克隆本身可收积分（一次性），单价放 `/api/models` 的 `voice_price.clone` 字段
- **合规**：`consent=true` 表示用户已声明有权使用该声音样本；请求缺失 → `400 consent_required`。后端保留样本与声明记录备审计。客户端在上传 UI 呈现声明文案
- 后端实现建议：对接 fish-audio（有社区二次元音色与克隆 API）或 MiniMax voice clone；供应商细节不进协议

## 6. 反馈（/api/feedback）

```
POST /api/feedback
{ "content": "文字反馈", "contact": "可选联系方式",
  "app_version": "1.0.0", "platform": "android",
  "device_info": "Xiaomi 14 / Android 15 (可选)",
  "logs": "<可选，客户端日志尾部，gzip+base64，解压后 ≤1MB>" }
→ 201 {}
```

- 匿名可用（未登录也能反馈）；有 token 则关联用户
- 这是零遥测方案（D14）下唯一的问题回传通道，后端至少要能存和看

## 7. 更新检查（/api/app/version）

```
GET /api/app/version?platform=android
→ 200 {
  "latest": "1.2.0",
  "min_supported": "1.0.0",      # 低于此版本客户端阻断使用并强制引导更新
  "apk_url": "https://dl.<域名>/app-1.2.0.apk",
  "sha256": "<apk 校验和>",
  "notes": "更新说明（支持 markdown）",
  "published_at": "2026-08-01T00:00:00Z"
}
```

- 客户端行为：`current < min_supported` → 强更弹窗（不可跳过）；`current < latest` → 可跳过提示
- 未登录也可访问

## 8. 预留占坑（不在 v1.0 实现）

| 前缀 | 用途 | 详设时点 |
|---|---|---|
| `/api/memory/*` | Honcho 云记忆代理（客户端不持有 Honcho key；可绑积分/会员） | M4 前 |
| `/api/datasources/*` | 个人数据源接入（穿戴/健康，主动关怀愿景） | 远期 |

## 9. 错误码总表

| HTTP | code | 场景 |
|---|---|---|
| 400 | `bad_request` / `consent_required` | 参数错误 / 缺声音授权声明 |
| 401 | `invalid_code` | 验证码错误或过期 |
| 401 | `invalid_token` / `token_expired` | token 无效/过期 → 客户端登出 |
| 402 | `insufficient_credits` | 积分不足 → 客户端引导卡密充值 |
| 403 | `voice_not_owned` / `voice_quota_exceeded` | 音色权限/配额 |
| 404 | `model_not_found` / `voice_not_found` / `invalid_redeem_code` | 资源不存在 |
| 409 | `redeem_code_used` | 卡密已用 |
| 429 | `rate_limited`（带 Retry-After） | 限流 |
| 500 | `internal_error` | 兜底 |

## 10. 客户端对接落点（前端参考）

| 协议部分 | 客户端改造点 |
|---|---|
| Base URL | `src/shared/request/chatboxai_pool.ts:5`（API_ORIGIN）、`src/renderer/packages/remote.ts:101`（getAPIOrigin） |
| 登录/验证码 | 改造 `remote.ts` 登录函数（requestLoginTicketId L735 一带）与 `stores/premiumActions.ts`（activate L158、reconcileLoginLicenseState L16） |
| 默认 provider | 参照 `src/shared/providers/definitions/chatboxai.ts` 新建自研服务定义 |
| 更新检查 | `remote.ts:144`（原 `/chatbox_need_update/`）→ §7 |
| 反馈 | 原 ReportContent/官方渠道 → §6 |

## 11. 开放问题（定稿前需拍板）

1. 正式域名（依赖品牌名 D17）
2. 注册赠送积分数额；模型首发清单与定价
3. STT 输入格式：后端支持 webm/opus，还是前端转码 aac
4. TTS 供应商最终选型（fish-audio vs MiniMax）与内置音色清单
5. token 是否需要多设备并存上限
