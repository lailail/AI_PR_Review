# AI PR Review Assistant

AI PR Review Assistant 是一个面向 GitHub Pull Request 的 AI 代码评审辅助工具。用户输入 GitHub PR 链接后，系统会获取 PR 变更内容，并逐步生成 PR 变更总结、风险代码识别和 Review 建议，帮助开发者提升评审效率与质量。

## 当前状态

当前仓库处于 PR 2 阶段：GitHub PR 数据获取。

本阶段已完成：

- GitHub PR URL 解析
- 后端 GitHub API 请求封装
- PR 基础信息获取
- changed files 和 patch 获取
- 前端加载状态、错误状态和结果展示
- GitHub Token 环境变量示例

本阶段暂未实现：

- AI 模型接入
- AI 生成 PR 变更总结
- 风险代码识别
- Review 建议生成

## 技术栈

- JavaScript
- Next.js
- React
- Next.js Route Handler
- GitHub REST API
- lucide-react
- CSS
- Vitest

## 本地运行

安装依赖：

```bash
npm install
```

复制环境变量示例：

```bash
cp .env.local.example .env.local
```

按需配置 GitHub Token：

```text
GITHUB_TOKEN=your_github_token
```

启动开发服务：

```bash
npm run dev
```

启动后访问：

```text
http://localhost:3000
```

## GitHub Token 说明

公开仓库的 PR 可以尝试匿名请求，但 GitHub 匿名 API 限流较低。建议配置 `GITHUB_TOKEN`，提升请求稳定性。

Token 只在服务端读取，用于请求 GitHub REST API，不会暴露到浏览器端。

## 可用命令

```bash
npm run dev
npm run lint
npm run test
npm run build
```

## 产品规划

最终工具会围绕 GitHub PR 完成以下流程：

1. 用户输入 GitHub PR URL。
2. 系统解析 owner、repo 和 PR 编号。
3. 系统通过 GitHub API 获取 PR 元数据、变更文件和 diff。
4. 系统筛选关键上下文，优先关注高风险变更。
5. 系统调用 AI 模型生成结构化 Review 结果。
6. 页面展示 PR 总结、风险点和可复制 Review 建议。

## AI 分析设计思路

系统不会简单地把完整 diff 一次性发送给模型，而是会先获取 PR 元数据、文件列表和 diff，再结合文件类型、变更规模、风险关键词等信息进行上下文筛选。

后续 AI 分析会优先关注：

- 权限与鉴权逻辑
- 数据库读写
- API 入参校验
- 异常处理
- 并发与异步逻辑
- 测试删除或覆盖不足
- 依赖与配置变更

## 误报与漏报控制

后续 Review 建议会尽量做到：

- 每条建议绑定文件和行号。
- 每条建议提供原因和修复方向。
- 每条建议标记严重级别。
- 每条建议提供置信度。
- 低置信度建议标记为“需要人工确认”。
- 风格类建议降低优先级，避免干扰核心评审。

## PR 开发计划

### PR 1：项目初始化与基础界面

- 初始化 Next.js 项目。
- 搭建首页基础 UI。
- 添加 GitHub PR URL 输入框。
- 添加“开始分析”按钮。
- 添加 README 初版。

### PR 2：GitHub PR 数据获取

- 解析 GitHub PR URL。
- 调用 GitHub API 获取 PR 基础信息。
- 获取 changed files 和 diff patch。
- 展示 PR 标题、作者、描述、文件数量和增删行信息。

### PR 3：PR 变更总结

- 接入 AI API。
- 基于 PR 元数据和 diff 生成变更总结。
- 展示业务变化、技术变化、测试变化和影响范围。

### PR 4：风险代码识别

- 基于规则预筛选高风险文件。
- 使用 AI 分析潜在风险。
- 输出风险等级、原因、文件位置和建议。

### PR 5：Review 建议生成与体验优化

- 生成结构化 Review 建议。
- 支持复制 Markdown Review。
- 优化加载状态和错误提示。
- 支持隐藏低置信度建议。
- 补充 Demo 视频链接。

## 代码注释规范

项目代码中的重要组件、核心方法和关键业务逻辑需要添加中文注释。注释重点解释设计意图和处理原因，避免只重复代码表面含义。

涉及 PR URL 解析、GitHub 数据获取、上下文筛选、AI 分析和风险识别的代码，都需要保留必要中文注释，方便评审者理解实现思路。
