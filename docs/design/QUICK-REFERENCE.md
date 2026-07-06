# V2Chat UI 重设计 - 快速参考

## 🎨 色彩速查

### 主色调
```css
紫罗兰   #8B7FD9  --chatbox-tint-brand
淡紫     #B4A5E8  --v2chat-lavender
```

### 强调色
```css
玫瑰色   #E8A5C5  --v2chat-rose           /* 用户消息 */
薄荷绿   #6ECFBD  --v2chat-mint           /* AI 消息 */
```

### 中性色
```css
深紫黑   #1A1625  --v2chat-purple-deep    /* 文字/深色背景 */
淡紫白   #F8F6FC  --chatbox-background-secondary
边界灰   #E5E1F0  --chatbox-border-primary
```

## 🔧 CSS 类速查

### 消息气泡
```tsx
// 用户消息
<div className="v2chat-message-bubble-user">
  {content}
</div>

// AI 消息
<div className={cn(
  "v2chat-message-bubble-assistant",
  isGenerating && "generating"  // 添加呼吸光晕
)}>
  {content}
</div>
```

### 输入框
```tsx
<Stack className="v2chat-input-elevated">
  {/* 输入框内容 */}
</Stack>
```

### 设置卡片
```tsx
<Box className="v2chat-settings-card">
  <Text fw={600}>标题</Text>
  <Text size="sm" c="chatbox-secondary">描述</Text>
</Box>
```

### 顶栏渐变
```tsx
<Box className="v2chat-header-gradient">
  {/* 顶栏内容 */}
</Box>
```

## 📏 尺寸规范

### 圆角
```css
消息气泡：18px (3个角) + 4px (1个尖角)
输入框：  24px
卡片：    12px
```

### 间距
```css
卡片间距：    16px
内边距：      12-16px
气泡内边距：  12px 16px
```

### 阴影
```css
/* 消息气泡 */
box-shadow: 0 2px 8px rgba(232, 165, 197, 0.08);  /* 用户 */
box-shadow: 0 2px 8px rgba(110, 207, 189, 0.08);  /* AI */

/* 输入框 */
box-shadow: 0 4px 16px rgba(26, 22, 37, 0.08);
/* 聚焦 */
box-shadow: 0 6px 24px rgba(139, 127, 217, 0.15);

/* 设置卡片 */
box-shadow: 0 1px 3px rgba(26, 22, 37, 0.04);
/* Hover */
box-shadow: 0 4px 12px rgba(139, 127, 217, 0.08);
```

## ⚡ 动画参数

### 呼吸光晕
```css
animation: breathing-glow 1.5s ease-in-out infinite;
opacity: 0 → 0.4 → 0
scale: 1 → 1.02 → 1
```

### 过渡效果
```css
transition: all 0.2s ease;  /* 通用 */
```

## 📱 响应式断点

```tsx
// 小屏幕检测
const isSmallScreen = useIsSmallScreen()

// 条件渲染
{!isSmallScreen && <DesktopOnly />}
{isSmallScreen && <MobileOnly />}
```

## 🎯 使用场景

### 场景 1: 聊天消息
```tsx
// Message.tsx 中
<div className={cn(
  msg.role === 'user' 
    ? 'v2chat-message-bubble-user'
    : cn(
        'v2chat-message-bubble-assistant',
        msg.generating && 'generating'
      )
)}>
  {content}
</div>
```

### 场景 2: 输入框
```tsx
// InputBox.tsx 中
<Stack className="v2chat-input-elevated" gap="xs">
  <Flex align="flex-end" gap={4}>
    <Textarea />
    <ActionIcon />
  </Flex>
</Stack>
```

### 场景 3: 设置页面
```tsx
// settings/*.tsx 中
<Stack p="md" gap="lg">
  <Box className="v2chat-settings-card">
    <Text fw={600}>Section Title</Text>
    {/* 内容 */}
  </Box>
</Stack>
```

## 🔍 调试技巧

### 检查样式是否生效
```javascript
// 浏览器控制台
getComputedStyle(document.documentElement)
  .getPropertyValue('--chatbox-tint-brand')
// 应该返回: #8B7FD9
```

### 检查类名是否应用
```javascript
// 查找消息气泡
document.querySelectorAll('.v2chat-message-bubble-assistant')
// 查找输入框
document.querySelectorAll('.v2chat-input-elevated')
```

### 强制刷新缓存
```
Ctrl + Shift + R  (Windows/Linux)
Cmd + Shift + R   (Mac)
```

## ⚠️ 常见问题

### Q: 样式没有生效？
**A**: 检查类名拼写，重启开发服务器

### Q: 呼吸光晕看不到？
**A**: 只在 AI 消息生成时显示，且需要 `.generating` 类

### Q: 深色模式颜色不对？
**A**: 检查 `data-mantine-color-scheme="dark"` 是否存在

### Q: 移动端样式异常？
**A**: 检查响应式断点，使用 `isSmallScreen`

## 📦 完整示例

### 完整的消息组件示例
```tsx
<Box className={cn(
  'group/message',
  msg.role === 'user' ? 'user-msg' : 'assistant-msg'
)}>
  <div className={cn(
    'inline-block max-w-full',
    msg.role === 'user'
      ? 'v2chat-message-bubble-user text-chatbox-tint-primary'
      : cn(
          'v2chat-message-bubble-assistant',
          msg.generating && 'generating'
        )
  )}>
    <Box className="msg-content">
      {content}
    </Box>
  </div>
</Box>
```

## 🔗 相关链接

- [完整设计文档](v2chat-ui-redesign.md)
- [测试指南](TESTING.md)
- [变更日志](CHANGELOG.md)
- [Frontend Design Skill](../../.claude/skills/frontend-design.md)

---

**提示**: 这是快速参考，详细说明请查看完整设计文档
