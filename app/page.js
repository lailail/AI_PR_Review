"use client";

import {
  AlertTriangle,
  ClipboardCheck,
  FileSearch,
  GitPullRequestArrow,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";

const reviewSections = [
  {
    title: "PR 变更总结",
    description: "后续会基于 PR 标题、描述、提交记录和 diff 生成结构化摘要。",
    icon: FileSearch,
  },
  {
    title: "风险代码识别",
    description: "优先关注权限、数据写入、配置、异常处理和依赖变化等高风险区域。",
    icon: AlertTriangle,
  },
  {
    title: "Review 建议生成",
    description: "输出带文件、行号、严重级别和置信度的可复制评审建议。",
    icon: ClipboardCheck,
  },
];

const workflowSteps = [
  "解析 GitHub PR 链接",
  "获取 PR 元数据与变更文件",
  "筛选关键上下文",
  "调用 AI 生成 Review 结果",
];

/**
 * 判断用户输入是否像一个 GitHub Pull Request 链接。
 * PR 1 阶段只做前端提示，不请求 GitHub；真实解析逻辑会在 PR 2 中实现。
 */
function getInputState(prUrl) {
  if (!prUrl.trim()) {
    return {
      label: "等待输入",
      message: "输入 GitHub PR 链接后，后续版本会自动拉取变更并分析。",
      tone: "neutral",
    };
  }

  if (!prUrl.includes("github.com") || !prUrl.includes("/pull/")) {
    return {
      label: "格式待确认",
      message: "建议使用类似 https://github.com/owner/repo/pull/123 的链接。",
      tone: "warning",
    };
  }

  return {
    label: "入口已就绪",
    message: "当前 PR 1 仅搭建分析入口，真实 GitHub 数据获取将在 PR 2 实现。",
    tone: "ready",
  };
}

/**
 * 首页是 PR 1 的核心交付物。
 * 页面采用工具工作台布局，让输入入口、处理流程和评审结果占位都能在首屏清晰出现。
 */
export default function Home() {
  const [prUrl, setPrUrl] = useState("");

  const inputState = useMemo(() => getInputState(prUrl), [prUrl]);

  /**
   * PR 1 阶段点击按钮只滚动到结果区域。
   * 这样可以演示完整使用路径，同时避免在初始化 PR 中混入真实 API 调用。
   */
  function handleAnalyzeClick() {
    document.getElementById("review-preview")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">
            <Sparkles size={16} aria-hidden="true" />
            AI assisted code review
          </p>
          <h1>AI PR Review Assistant</h1>
        </div>
        <span className="stage-badge">PR 1 初始化版本</span>
      </header>

      <section className="workspace" aria-label="AI PR Review 工作台">
        <div className="primary-panel">
          <div className="panel-heading">
            <SearchCheck size={24} aria-hidden="true" />
            <div>
              <h2>输入 Pull Request 链接</h2>
              <p>当前版本先提供评审入口和结果区域，后续 PR 将接入真实 GitHub 数据与 AI 分析。</p>
            </div>
          </div>

          <div className="input-panel" aria-label="PR 分析入口">
            <label htmlFor="pr-url">GitHub PR URL</label>
            <div className="input-row">
              <input
                id="pr-url"
                type="url"
                value={prUrl}
                onChange={(event) => setPrUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
              />
              <button type="button" onClick={handleAnalyzeClick}>
                <GitPullRequestArrow size={18} aria-hidden="true" />
                开始分析
              </button>
            </div>
            <p className={`input-state ${inputState.tone}`}>
              <strong>{inputState.label}</strong>
              <span>{inputState.message}</span>
            </p>
          </div>
        </div>

        <aside className="workflow-panel" aria-label="AI Review 工作流预览">
          <h2>分析流程</h2>
          <div className="workflow-list">
            {workflowSteps.map((step, index) => (
              <div className="workflow-step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <p>{step}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="review-layout" id="review-preview" aria-label="评审能力预览">
        <div className="section-heading">
          <p className="eyebrow dark">
            <ShieldCheck size={16} aria-hidden="true" />
            PR 1 capability preview
          </p>
          <h2>核心评审区域已预留</h2>
          <p>
            当前版本先建立稳定页面结构。后续 PR 会逐步接入 GitHub 数据获取、AI 总结、风险检测和可复制 Review 建议。
          </p>
        </div>

        <div className="review-grid">
          {reviewSections.map((section) => {
            const Icon = section.icon;

            return (
              <article className="review-card" key={section.title}>
                <Icon size={24} aria-hidden="true" />
                <h3>{section.title}</h3>
                <p>{section.description}</p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
