# V2Chat UI/UX 重设计方案

> 设计日期：2026-07-06  
> 目标平台：Android 移动端优先

## 设计目标

为 V2Chat 创建一个女性化但不过分粉色的视觉风格，提升用户体验的亲和力和现代感。

## 色彩系统

### 主色调
- **柔和紫罗兰** `#8B7FD9` - 品牌主色，温暖科技感
- **淡紫** `#B4A5E8` - 辅助色，用于背景和浅色区域

### 强调色
- **柔和玫瑰** `#E8A5C5` - 重要操作、用户消息气泡
- **薄荷绿** `#6ECFBD` - AI 消息气泡、成功状态

### 中性色
- **深紫黑** `#1A1625` - 文本、深色元素
- **淡紫白** `#F8F6FC` - 背景、卡片
- **边界灰紫** `#E5E1F0` - 边界线

### 设计理由
- 避开常见的奶油色 + 陶土色组合
- 避开纯粉色，使用柔和玫瑰
- 紫色系传达智慧与创意
- 薄荷绿带来清新感
- 女性化但不幼稚，适合专业工具

## 字体系统

- **标题/品牌**: Inter（几何感，现代，600/700 weight）
- **正文/对话**: 系统字体 SF Pro Text / Roboto（400/500 weight）
- **代码/数据**: JetBrains Mono（等宽）

**字阶**: 28 / 20 / 16 / 14 / 12

## 核心组件设计

### 1. 消息气泡

#### 用户消息
- 背景：柔和玫瑰半透明 `rgba(232, 165, 197, 0.15)`
- 圆角：`18px 18px 4px 18px`（右上角尖）
- 对齐：右对齐
- 阴影：`0 2px 8px rgba(232, 165, 197, 0.08)`

#### AI 消息
- 背景：薄荷绿半透明 `rgba(110, 207, 189, 0.12)`
- 圆角：`18px 18px 18px 4px`（左上角尖）
- 对齐：左对齐
- 阴影：`0 2px 8px rgba(110, 207, 189, 0.08)`

#### 特色功能：呼吸光晕
当 AI 正在生成回复时，消息气泡边缘会显示柔和的"呼吸"动效：
- 薄荷绿光晕从透明到半透明循环
- 1.5 秒循环周期
- 微妙的缩放效果（1.00 → 1.02）
- 让等待变得不枯燥，强化 AI 的"生命感"

### 2. 输入框
- 白色卡片背景
- 圆角：24px
- 浮起效果：`box-shadow: 0 4px 16px rgba(26, 22, 37, 0.08)`
- 聚焦时增强阴影和紫色边框

### 3. 设置页面卡片
- 白色背景 + 柔和阴影
- 圆角：12px
- Hover 时显示紫色边框和加深阴影
- 分组间距：16px

## 实施的 CSS 类

### 消息气泡类
```css
.v2chat-message-bubble-user       /* 用户消息 */
.v2chat-message-bubble-assistant  /* AI 消息 */
.generating                        /* 生成中状态，附加到 assistant 类 */
```

### 功能类
```css
.v2chat-settings-card      /* 设置页面卡片 */
.v2chat-header-gradient    /* 顶栏渐变背景 */
.v2chat-input-elevated     /* 输入框浮起效果 */
```

## CSS 变量更新

更新了 `src/renderer/static/globals.css` 中的所有品牌色变量：

**浅色模式:**
- `--chatbox-tint-brand`: `#8B7FD9`
- `--chatbox-border-brand`: `#8B7FD9`
- `--chatbox-background-brand-primary`: `#8B7FD9`
- `--chatbox-tint-success`: `#6ECFBD`
- 新增 `--v2chat-rose`, `--v2chat-mint`, `--v2chat-lavender` 等

**深色模式:**
- `--chatbox-tint-brand`: `#B4A5E8`
- `--chatbox-background-primary`: `#1A1625`（深紫黑）
- 所有颜色都有深色模式适配

## 布局特点

### 聊天界面
```
┌─────────────────────────┐
│ ◀  V2Chat      ⋮  ⚙    │ 渐变紫色顶栏
├─────────────────────────┤
│                         │
│  ┌──────────────┐      │ AI 消息（左对齐）
│  │ Hi! I'm...   │      │ 薄荷绿背景
│  └──────────────┘      │ 左上角尖
│                         │
│       ┌──────────────┐ │ 用户消息（右对齐）
│       │ Tell me...   │ │ 玫瑰色背景
│       └──────────────┘ │ 右上角尖
│                         │
│  ┌──────────────┐      │ 生成中：呼吸光晕
│  │ [AI 回复中...]│      │
│  └──────────────┘      │
│                         │
├─────────────────────────┤
│ 💬  Type message...  📎│ 浮起的白色卡片
│                      🎤│
└─────────────────────────┘
```

### 设置页面
```
┌─────────────────────────┐
│ ◀  Settings             │
├─────────────────────────┤
│ ┌─────────────────────┐ │
│ │ 🎭 Model Config     │ │ 分组卡片
│ │                     │ │ 12dp 圆角
│ │ OpenAI / Claude ... │ │
│ └─────────────────────┘ │
│                         │
│ ┌─────────────────────┐ │
│ │ 🔑 API Settings     │ │
│ │ V2API Key: ****     │ │
│ └─────────────────────┘ │
└─────────────────────────┘
```

## 避开的 AI 设计陷阱

✓ **已避开:**
- 奶油色背景 `#F4F1EA` + 陶土色
- 纯黑背景 + 荧光绿/朱红
- 报纸式布局（细线、零圆角、密集列）

✓ **独特性:**
- 紫色 + 薄荷绿的独特组合
- 呼吸光晕动效是记忆点
- 不对称圆角气泡有个性

## 下一步实施

### 需要修改的组件文件

1. **消息组件** `src/renderer/components/chat/Message.tsx`
   - 添加 `v2chat-message-bubble-*` 类名
   - 根据 `msg.role` 和 `msg.generating` 应用对应样式

2. **消息列表** `src/renderer/components/chat/MessageList.tsx`
   - 确保消息气泡布局正确

3. **输入框** `src/renderer/components/InputBox/InputBox.tsx`
   - 添加 `v2chat-input-elevated` 类

4. **设置页面** `src/renderer/routes/settings/*.tsx`
   - 设置卡片添加 `v2chat-settings-card` 类

5. **顶栏组件**
   - 添加 `v2chat-header-gradient` 渐变背景

## 测试检查项

- [ ] 浅色模式颜色正确
- [ ] 深色模式颜色正确
- [ ] 消息气泡不对称圆角显示正常
- [ ] AI 生成时呼吸光晕动效流畅
- [ ] 输入框浮起效果正常
- [ ] 设置页面卡片 hover 效果正常
- [ ] 所有交互状态（hover、focus、active）正常
- [ ] 移动端触摸反馈正常

## 设计原则

遵循 Frontend Design Skill 的方法论：
1. **Ground in the subject** - 基于 AI 聊天工具的特性设计
2. **Typography carries personality** - 字体传递品牌个性
3. **Structure is information** - 结构传递信息（消息方向）
4. **Leverage motion deliberately** - 动效有目的（呼吸光晕表示思考）

## 版权声明

设计遵循 V2Chat 项目规范，适配于 Android 移动端优先。
