# Git 提交建议

## 📝 提交信息

```
feat: V2Chat UI/UX 重设计 - 紫色系女性化风格

- 品牌色从蓝色改为紫色系 (#8B7FD9)
- 消息气泡重设计：玫瑰色用户消息，薄荷绿 AI 消息
- 添加呼吸光晕动效（AI 生成时的签名元素）
- 输入框浮起效果优化
- 完整的深色模式适配
- 创建完整设计文档体系

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## 🔍 查看变更

```powershell
cd F:\selfProject\v2api-chat\v2chat
git status
git diff src/renderer/static/globals.css
git diff src/renderer/components/chat/Message.tsx
git diff src/renderer/components/InputBox/InputBox.tsx
```

## 💾 提交变更

### 方案 A: 一次性提交所有文件

```powershell
cd F:\selfProject\v2api-chat\v2chat

# 添加所有修改和新文件
git add .

# 提交
git commit -m "feat: V2Chat UI/UX 重设计 - 紫色系女性化风格

- 品牌色从蓝色改为紫色系 (#8B7FD9)
- 消息气泡重设计：玫瑰色用户消息，薄荷绿 AI 消息
- 添加呼吸光晕动效（AI 生成时的签名元素）
- 输入框浮起效果优化
- 完整的深色模式适配
- 创建完整设计文档体系

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### 方案 B: 分开提交（更清晰）

#### 提交 1: 样式和组件更新
```powershell
git add src/renderer/static/globals.css
git add src/renderer/components/chat/Message.tsx
git add src/renderer/components/InputBox/InputBox.tsx
git add src/renderer/routes/settings/test-design.tsx
git add package.json

git commit -m "feat(ui): 实施紫色系品牌色和新消息气泡设计

- 更新主题色系统：蓝色 -> 紫色 (#8B7FD9)
- 消息气泡不对称圆角设计
- 添加呼吸光晕动效
- 输入框浮起效果
- 调整 Node 版本限制

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

#### 提交 2: 设计文档
```powershell
git add docs/design/
git add docs/QUICKSTART.md
git add docs/BUILD-STATUS.md
git add .claude/skills/frontend-design.md

git commit -m "docs: 添加 V2Chat UI 重设计完整文档

- 设计规范文档
- 测试指南
- 快速参考手册
- 变更日志和实施总结
- Frontend Design Skill

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

## 🌿 创建功能分支（可选）

如果想在单独的分支上保存这些改动：

```powershell
# 创建新分支
git checkout -b feature/ui-redesign-purple

# 提交变更
git add .
git commit -m "feat: V2Chat UI/UX 重设计 - 紫色系女性化风格

详见 docs/design/PROJECT-SUMMARY.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"

# 推送到远程（如果需要）
git push -u origin feature/ui-redesign-purple
```

## 📊 变更统计

```powershell
# 查看变更文件数量
git status --short

# 查看代码行数变化
git diff --stat
```

## 🔄 如果需要回滚

### 回滚单个文件
```powershell
git checkout src/renderer/static/globals.css
```

### 回滚所有未提交的改动
```powershell
git checkout .
```

### 回滚已提交的改动
```powershell
# 查看提交历史
git log --oneline

# 回滚到特定提交
git revert <commit-hash>
```

## 📝 .gitignore 建议

确保以下内容在 `.gitignore` 中：
```
node_modules/
.pnpm-store/
dist/
out/
build/
*.log
.DS_Store
```

## 🏷️ 创建版本标签（可选）

如果这是一个重要的里程碑版本：

```powershell
git tag -a v0.1.0-ui-redesign -m "V2Chat UI 重设计 - 紫色系"
git push origin v0.1.0-ui-redesign
```

---

**建议**：先提交到本地，测试效果满意后再推送到远程仓库。
