# AI PR Review Assistant

AI PR Review Assistant 是一个面向 GitHub Pull Request 的 AI 代码评审辅助工具。用户输入 GitHub PR 链接后，系统会获取 PR 变更内容，并逐步生成 PR 变更总结、风险代码识别和 Review 建议，帮助开发者提升评审效率与质量。

## 当前状态

当前仓库处于 PR 5 阶段：Review 建议生成与体验优化。

本阶段已完成：

- GitHub PR URL 解析
- 后端 GitHub API 请求封装
- PR 基础信息获取
- changed files 和 patch 获取
- 前端加载状态、错误状态和结果展示
- GitHub Token 环境变量示例
- DeepSeek API 服务端调用
- AI 生成结构化 PR 变更总结
- 规则预筛选高风险文件
- DeepSeek 生成结构化风险识别结果
- DeepSeek 生成结构化 Review 建议
- 低置信度建议过滤
- Markdown Review 结果复制

## 技术栈

- JavaScript
- Next.js
- React
- Next.js Route Handler
- GitHub REST API
- DeepSeek API
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

按需配置 GitHub Token 和 DeepSeek API Key：

```text
GITHUB_TOKEN=your_github_token
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_CONTEXT_API_KEY=
DEEPSEEK_CONTEXT_MODEL=deepseek-v4-pro
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

## DeepSeek API Key 说明

PR 变更总结、风险代码识别和 Review 建议由服务端调用 DeepSeek Chat Completions 接口生成。

真实 API Key 必须只写在本地 `.env.local` 文件中：

```text
DEEPSEEK_API_KEY=your_deepseek_api_key
```

`.env.local` 已在 `.gitignore` 中忽略，不能提交到 GitHub。仓库中只提交 `.env.local.example`，用于说明需要哪些环境变量。

如果其他人下载本项目代码，需要自己复制 `.env.local.example` 并创建本地 `.env.local` 文件，然后填写自己的 API Key。真实 Key 不会也不应该出现在 GitHub 仓库中。

默认配置：

```text
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_CONTEXT_API_KEY=
DEEPSEEK_CONTEXT_MODEL=deepseek-v4-pro
```

前端不会读取 DeepSeek API Key，只会调用本项目的 `/api/ai-summary`、`/api/risk-detection` 和 `/api/review-suggestions` 后端接口。

页面右上角提供“模型配置”入口，用于本地演示时切换 DeepSeek API Key 和模型。用户填写 API Key 后可以点击“获取模型”，系统会调用 DeepSeek `/models` 接口获取该 Key 可用的模型列表，再从下拉框中选择模型。该功能会通过后端写入本地 `.env.local`，只适合本地开发环境；如果部署到公网服务器，不应该开放给未授权用户修改。

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
5. 系统调用 DeepSeek 生成结构化 PR 总结、风险识别结果和 Review 建议。
6. 页面展示 PR 总结、风险点和可复制 Markdown Review 建议。

## AI 分析设计思路

系统不会简单地把完整 diff 一次性发送给模型，而是会先获取 PR 元数据、文件列表和 diff，再结合文件类型、变更规模、风险关键词等信息进行上下文筛选。

当前 PR 5 阶段会将 PR 标题、描述、变更规模、文件列表、规则预筛选信号、AI 总结、风险识别结果和截断后的 patch 发送给 DeepSeek，要求模型返回 JSON 格式的结构化总结、风险识别结果或 Review 建议。

风险识别会先通过规则预筛选高风险文件，例如鉴权、接口、数据库、配置、依赖和测试文件变化，再优先把这些文件的 patch 放入模型上下文，以提升分析速度和相关性。

Review 建议生成会优先复用 PR 总结和风险识别结果，让模型围绕已有证据输出建议，避免脱离 diff 的泛泛评论。

AI 分析会优先关注：

- 权限与鉴权逻辑
- 数据库读写
- API 入参校验
- 异常处理
- 并发与异步逻辑
- 测试删除或覆盖不足
- 依赖与配置变更

## 误报与漏报控制

当前风险识别与后续 Review 建议会尽量做到：

- 每条建议绑定文件和行号。
- 每条建议提供原因和修复方向。
- 每条建议标记严重级别。
- 每条建议提供置信度。
- 低置信度建议标记为“需要人工确认”。
- 风格类建议降低优先级，避免干扰核心评审。
- 规则预筛选只作为信号，不直接当成最终风险结论。
- 缺少 diff 证据的风险不会展示。
- 默认隐藏低置信度 Review 建议，用户可手动显示。
- 复制出的 Markdown 会提示低置信度建议需要人工确认。

## 响应速度优化

- 后端限制发送给 DeepSeek 的文件数量。
- 单个 patch 会按固定长度截断，避免大 PR 请求过慢。
- 风险识别和 Review 建议会优先分析高风险文件。
- 前端将 GitHub 数据获取、总结、风险识别和 Review 建议拆成独立按钮，用户可以按需触发，避免一次性等待所有 AI 调用。

## 模型选择说明

本项目选择 DeepSeek Chat Completions 兼容接口，原因是：

- 接口形式接近常见 Chat Completions，便于在 Next.js Route Handler 中封装。
- 支持 JSON 输出约束，适合生成结构化总结、风险和 Review 建议。
- 对代码 diff、配置变更和中文说明有较好的处理能力。
- 服务端集中调用，便于后续替换为其他兼容模型或多模型交叉验证。

## 上下文获取方式

系统通过 GitHub REST API 获取 PR 基础信息和 changed files。前端只提交 PR URL，后端解析 owner、repo 和 PR 编号后请求 GitHub API，并把 PR 元数据、文件列表和 patch 返回给前端。

AI 分析不会直接发送完整仓库代码，而是基于 PR 标题、描述、增删行、文件状态、规则预筛选结果和截断后的 patch 构造上下文。这样可以在准确性、上下文完整度、响应速度和调用成本之间取得平衡。

## Demo 视频

Demo 视频：录制完成后补充链接。

## 未来扩展方向

- GitHub App 自动把 Review 建议评论到 PR。
- 使用 AST 或语言服务器提取更准确的函数、变量和行号上下文。
- 支持团队自定义 Review 规则，例如安全规则、命名规范和测试要求。
- 支持多模型交叉验证，降低单模型误报或漏报。
- 缓存 GitHub PR 数据和 AI 分析结果，提升重复访问速度。
- 支持导出完整 Review 报告。
- 支持对比测试覆盖率变化。

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

- 接入 DeepSeek API。
- 基于 PR 元数据和 diff 生成变更总结。
- 展示业务变化、技术变化、测试变化和影响范围。

### PR 4：风险代码识别

- 基于规则预筛选高风险文件。
- 使用 DeepSeek 分析潜在风险。
- 输出风险等级、类别、文件位置、证据、原因、建议和置信度。

### PR 5：Review 建议生成与体验优化

- 生成结构化 Review 建议。
- 支持复制 Markdown Review。
- 优化加载状态和错误提示。
- 支持隐藏低置信度建议。
- 补充 Demo 视频链接。

## 代码注释规范

项目代码中的重要组件、核心方法和关键业务逻辑需要添加中文注释。注释重点解释设计意图和处理原因，避免只重复代码表面含义。

涉及 PR URL 解析、GitHub 数据获取、上下文筛选、AI 分析和风险识别的代码，都需要保留必要中文注释，方便评审者理解实现思路。
