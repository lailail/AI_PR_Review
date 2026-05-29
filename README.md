# AI PR Review Assistant

AI PR Review Assistant 是一个面向 GitHub Pull Request 的 AI 代码评审辅助工具。用户输入 GitHub PR 链接后，系统会逐步获取 PR 变更内容，并生成 PR 变更总结、风险代码识别和 Review 建议，帮助开发者提升评审效率与质量。

## 当前状态

当前仓库处于 PR 1 阶段：项目初始化与基础界面。

本阶段已完成：

- Next.js 项目骨架
- 首页基础 UI
- GitHub PR URL 输入入口
- 分析结果占位区
- 后续能力说明

本阶段暂未实现：

- GitHub API 调用
- 真实 PR diff 获取
- AI 模型接入
- 真实 Review 建议生成

## 技术栈

- JavaScript
- Next.js
- React
- lucide-react
- CSS

## 本地运行

```bash
npm install
npm run dev
```

启动后访问：

```text
http://localhost:3000
```

构建项目：

```bash
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

