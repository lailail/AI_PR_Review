"use client";

import {
  AlertTriangle,
  ClipboardCheck,
  ExternalLink,
  FileCode2,
  FileSearch,
  GitPullRequestArrow,
  Loader2,
  MessageSquareText,
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
  "整理 diff patch 上下文",
  "生成总结并识别风险代码",
];

function getInputState(prUrl) {
  if (!prUrl.trim()) {
    return {
      label: "等待输入",
      message: "输入 GitHub PR 链接后，系统会自动获取 PR 基础信息和变更文件。",
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
    label: "可以获取",
    message: "点击开始分析后，将通过后端接口请求 GitHub PR 数据。",
    tone: "ready",
  };
}

function formatDate(dateValue) {
  if (!dateValue) {
    return "未知";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(dateValue));
}

function getFileStatusLabel(status) {
  const statusMap = {
    added: "新增",
    modified: "修改",
    removed: "删除",
    renamed: "重命名",
    changed: "变更",
  };

  return statusMap[status] || status;
}

function truncatePatch(patch) {
  if (!patch) {
    return "该文件没有可展示的 patch，可能是二进制文件或变更过大。";
  }

  return patch.length > 900 ? `${patch.slice(0, 900)}\n...` : patch;
}

/**
 * 首页是 PR 4 的主要交互面。
 * 前端只请求项目自己的 API Route，GitHub Token、DeepSeek API Key 和外部 API 细节都由服务端处理。
 */
export default function Home() {
  const [prUrl, setPrUrl] = useState("");
  const [pullRequestData, setPullRequestData] = useState(null);
  const [summary, setSummary] = useState(null);
  const [riskResult, setRiskResult] = useState(null);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [riskError, setRiskError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [isRiskLoading, setIsRiskLoading] = useState(false);

  const inputState = useMemo(() => getInputState(prUrl), [prUrl]);

  /**
   * 提交 PR URL 后调用后端接口获取真实 GitHub 数据。
   * 这里不直接访问 GitHub，是为了避免把服务端 Token 暴露到浏览器。
   */
  async function handleAnalyzeSubmit(event) {
    event.preventDefault();
    setError("");
    setSummary("");
    setRiskResult(null);
    setSummaryError("");
    setRiskError("");
    setPullRequestData(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/github-pr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prUrl }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "获取 Pull Request 数据失败。");
      }

      setPullRequestData(data);
      document.getElementById("review-preview")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * 生成 PR 变更总结。
   * 只有先获取 GitHub PR 数据，才有足够上下文交给 DeepSeek 做结构化总结。
   */
  async function handleGenerateSummary() {
    if (!pullRequestData) {
      return;
    }

    setSummaryError("");
    setSummary(null);
    setIsSummaryLoading(true);

    try {
      const response = await fetch("/api/ai-summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pullRequestData),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "生成 PR 变更总结失败。");
      }

      setSummary(data.summary);
    } catch (requestError) {
      setSummaryError(requestError.message);
    } finally {
      setIsSummaryLoading(false);
    }
  }

  /**
   * 识别 PR 风险代码。
   * 风险识别依赖已获取的 PR diff，上下文和 DeepSeek API Key 都由服务端接口处理。
   */
  async function handleDetectRisks() {
    if (!pullRequestData) {
      return;
    }

    setRiskError("");
    setRiskResult(null);
    setIsRiskLoading(true);

    try {
      const response = await fetch("/api/risk-detection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(pullRequestData),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || "识别 PR 风险代码失败。");
      }

      setRiskResult(data);
    } catch (requestError) {
      setRiskError(requestError.message);
    } finally {
      setIsRiskLoading(false);
    }
  }

  const pr = pullRequestData?.pr;
  const files = pullRequestData?.files || [];

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
        <span className="stage-badge">PR 4 风险识别版本</span>
      </header>

      <section className="workspace" aria-label="AI PR Review 工作台">
        <div className="primary-panel">
          <div className="panel-heading">
            <SearchCheck size={24} aria-hidden="true" />
            <div>
              <h2>输入 Pull Request 链接</h2>
              <p>系统会解析 PR URL，获取 GitHub 变更上下文，并可调用 DeepSeek 生成总结和识别风险代码。</p>
            </div>
          </div>

          <form className="input-panel" aria-label="PR 分析入口" onSubmit={handleAnalyzeSubmit}>
            <label htmlFor="pr-url">GitHub PR URL</label>
            <div className="input-row">
              <input
                id="pr-url"
                type="url"
                value={prUrl}
                onChange={(event) => setPrUrl(event.target.value)}
                placeholder="https://github.com/owner/repo/pull/123"
                disabled={isLoading}
              />
              <button type="submit" disabled={isLoading}>
                {isLoading ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <GitPullRequestArrow size={18} aria-hidden="true" />
                )}
                {isLoading ? "获取中" : "开始分析"}
              </button>
            </div>
            <p className={`input-state ${inputState.tone}`}>
              <strong>{inputState.label}</strong>
              <span>{inputState.message}</span>
            </p>
            {error ? <p className="error-message">{error}</p> : null}
          </form>

          {pr ? (
            <div className="summary-action">
              <button type="button" onClick={handleGenerateSummary} disabled={isSummaryLoading}>
                {isSummaryLoading ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <MessageSquareText size={18} aria-hidden="true" />
                )}
                {isSummaryLoading ? "生成中" : "生成变更总结"}
              </button>
              <p>基于已获取的 PR 标题、描述、变更文件和 diff patch 调用 DeepSeek。</p>
              <button type="button" className="risk-button" onClick={handleDetectRisks} disabled={isRiskLoading}>
                {isRiskLoading ? (
                  <Loader2 className="spin" size={18} aria-hidden="true" />
                ) : (
                  <AlertTriangle size={18} aria-hidden="true" />
                )}
                {isRiskLoading ? "识别中" : "识别风险代码"}
              </button>
              <p>结合规则预筛选和 DeepSeek 分析权限、数据、配置、测试等高风险变更。</p>
            </div>
          ) : null}
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

      <section className="review-layout" id="review-preview" aria-label="PR 数据预览">
        <div className="section-heading">
          <p className="eyebrow dark">
            <ShieldCheck size={16} aria-hidden="true" />
            GitHub PR context
          </p>
          <h2>{pr ? pr.title : "等待获取 Pull Request 数据"}</h2>
          <p>
            {pr
              ? `已获取 ${pr.owner}/${pr.repo} #${pr.number} 的基础信息和 ${files.length} 个变更文件。`
              : "当前区域会展示真实 PR 信息。获取成功后可生成 DeepSeek 总结并识别风险代码。"}
          </p>
        </div>

        {pr ? (
          <>
            <div className="pr-summary">
              <div>
                <span>作者</span>
                <strong>{pr.author}</strong>
              </div>
              <div>
                <span>状态</span>
                <strong>{pr.state}</strong>
              </div>
              <div>
                <span>增删行</span>
                <strong>
                  +{pr.additions} / -{pr.deletions}
                </strong>
              </div>
              <div>
                <span>文件数</span>
                <strong>{pr.changedFiles}</strong>
              </div>
            </div>

            <div className="pr-meta">
              <p>
                <strong>更新时间：</strong>
                {formatDate(pr.updatedAt)}
              </p>
              <a href={pr.htmlUrl} target="_blank" rel="noreferrer">
                在 GitHub 打开
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </div>

            <div className="pr-body">
              <h3>PR 描述</h3>
              <p>{pr.body || "该 PR 没有填写描述。"}</p>
            </div>

            <div className="ai-summary-panel">
              <div className="files-heading">
                <MessageSquareText size={20} aria-hidden="true" />
                <h3>AI 变更总结</h3>
              </div>
              {summaryError ? <p className="error-message">{summaryError}</p> : null}
              {summary ? (
                <div className="summary-result">
                  <p className="summary-overview">{summary.overview}</p>
                  <SummaryList title="业务变化" items={summary.businessChanges} />
                  <SummaryList title="技术变化" items={summary.technicalChanges} />
                  <SummaryList title="测试变化" items={summary.testChanges} />
                  <SummaryList title="影响范围" items={summary.impactScope} />
                  <SummaryList title="Review 关注点" items={summary.reviewFocus} />
                </div>
              ) : (
                <p className="summary-empty">
                  点击“生成变更总结”后，这里会展示 DeepSeek 基于当前 PR 上下文生成的结构化摘要。
                </p>
              )}
            </div>

            <div className="risk-panel">
              <div className="files-heading">
                <AlertTriangle size={20} aria-hidden="true" />
                <h3>风险代码识别</h3>
              </div>
              {riskError ? <p className="error-message">{riskError}</p> : null}
              {riskResult ? (
                <RiskDetectionResult risks={riskResult.risks} ruleSignals={riskResult.ruleSignals} />
              ) : (
                <p className="summary-empty">
                  点击“识别风险代码”后，这里会展示风险等级、证据、原因、建议和置信度。
                </p>
              )}
            </div>

            <div className="files-panel">
              <div className="files-heading">
                <FileCode2 size={20} aria-hidden="true" />
                <h3>变更文件</h3>
              </div>
              <div className="file-list">
                {files.map((file) => (
                  <details className="file-item" key={file.filename}>
                    <summary>
                      <span className="file-name">{file.filename}</span>
                      <span className={`file-status ${file.status}`}>
                        {getFileStatusLabel(file.status)}
                      </span>
                      <span className="file-changes">
                        +{file.additions} / -{file.deletions}
                      </span>
                    </summary>
                    <pre>{truncatePatch(file.patch)}</pre>
                  </details>
                ))}
              </div>
            </div>
          </>
        ) : (
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
        )}
      </section>
    </main>
  );
}

function SummaryList({ title, items }) {
  return (
    <div className="summary-list">
      <h4>{title}</h4>
      <ul>
        {(items || []).map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function RiskDetectionResult({ risks = [], ruleSignals = [] }) {
  return (
    <div className="risk-result">
      {risks.length > 0 ? (
        <div className="risk-list">
          {risks.map((risk) => (
            <article className={`risk-item ${risk.severity}`} key={`${risk.file}-${risk.evidence}`}>
              <div className="risk-item-header">
                <span className={`severity-badge ${risk.severity}`}>{getSeverityLabel(risk.severity)}</span>
                <strong>{risk.category}</strong>
                <span>{Math.round((risk.confidence || 0) * 100)}% 置信度</span>
              </div>
              <p className="risk-file">{risk.file}</p>
              <p>
                <strong>证据：</strong>
                {risk.evidence}
              </p>
              <p>
                <strong>原因：</strong>
                {risk.reason}
              </p>
              <p>
                <strong>建议：</strong>
                {risk.suggestion}
              </p>
              {risk.confidence < 0.5 ? <p className="low-confidence">低置信度，建议人工确认。</p> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="summary-empty">未发现明显高风险变更，仍建议 Reviewer 结合业务上下文人工确认。</p>
      )}

      {ruleSignals.length > 0 ? (
        <div className="rule-signal-panel">
          <h4>规则预筛选信号</h4>
          <ul>
            {ruleSignals.map((signal) => (
              <li key={signal.file}>
                <strong>{signal.file}</strong>
                <span>{signal.labels.join("、")}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function getSeverityLabel(severity) {
  const labelMap = {
    high: "高风险",
    medium: "中风险",
    low: "低风险",
  };

  return labelMap[severity] || "低风险";
}
