import { getRepositoryKey } from "./history-store";

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_CONTEXT_MODEL = "deepseek-v4-pro";
const DEFAULT_MODEL = "deepseek-v4-flash";
const DEFAULT_MAX_HISTORY = 10;

export class HistoryComparisonError extends Error {
  constructor(code, message, status = 500) {
    super(code);
    this.name = "HistoryComparisonError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

function cleanJsonText(text) {
  return String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }

  return [];
}

function normalizeConfidence(value) {
  const confidence = Number(value);

  return Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5;
}

function sortByAnalyzedAtDesc(first, second) {
  return (Date.parse(second.analyzedAt) || 0) - (Date.parse(first.analyzedAt) || 0);
}

function summarizeSummary(summary = {}) {
  return {
    overview: summary?.overview || "",
    businessChanges: normalizeList(summary?.businessChanges),
    technicalChanges: normalizeList(summary?.technicalChanges),
    testChanges: normalizeList(summary?.testChanges || summary?.testingChanges),
    impactScope: normalizeList(summary?.impactScope),
    reviewFocus: normalizeList(summary?.reviewFocus),
  };
}

function summarizeRisks(risks = []) {
  return risks.slice(0, 20).map((risk) => ({
    file: String(risk.file || ""),
    severity: String(risk.severity || "low"),
    category: String(risk.category || ""),
    reason: String(risk.reason || ""),
    suggestion: String(risk.suggestion || ""),
    confidence: normalizeConfidence(risk.confidence),
  }));
}

function summarizeSuggestions(suggestions = []) {
  return suggestions.slice(0, 20).map((suggestion) => ({
    file: String(suggestion.file || ""),
    line: suggestion.line ?? null,
    severity: String(suggestion.severity || "low"),
    problem: String(suggestion.problem || ""),
    suggestion: String(suggestion.suggestion || ""),
    confidence: normalizeConfidence(suggestion.confidence),
  }));
}

function summarizePatchDigest(patchDigest = []) {
  return patchDigest.slice(0, 8).map((file) => ({
    filename: String(file.filename || ""),
    status: String(file.status || ""),
    changes: Number(file.changes) || 0,
    excerpt: String(file.excerpt || "").slice(0, 600),
  }));
}

export function selectHistoryForComparison(currentPr, historyRecords = [], options = {}) {
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
  const repositoryKey = getRepositoryKey(currentPr);

  /**
   * 历史对比只选择同仓库记录，并排除当前 PR 自己。
   * 这样可以减少无关仓库噪声，同时避免当前 PR 在 current 和 history 中重复占用上下文。
   */
  return historyRecords
    .filter((record) => record.repositoryKey === repositoryKey && record.prNumber !== currentPr.number)
    .sort(sortByAnalyzedAtDesc)
    .slice(0, maxHistory);
}

export function buildHistoryComparisonContext(current = {}, historyRecords = [], options = {}) {
  const pr = current.pr;

  if (!pr) {
    throw new HistoryComparisonError(
      "INVALID_COMPARISON_REQUEST",
      "缺少当前 PR 分析结果，无法生成历史对比。",
      400,
    );
  }

  const repository = getRepositoryKey(pr);
  const selectedHistory = selectHistoryForComparison(pr, historyRecords, options);

  /**
   * 历史 PR 只作为上下文补充，不替代当前 PR diff 判断。
   * 这里仅保留历史摘要、风险、建议和截断 patchDigest，避免把完整 diff 堆进大上下文。
   */
  return {
    repository,
    mode: current.mode || options.mode || "compare-with-history",
    currentPr: {
      number: pr.number,
      title: pr.title || "",
      author: pr.author || "unknown",
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changedFiles: pr.changedFiles || 0,
    },
    current: {
      summary: summarizeSummary(current.summary),
      risks: summarizeRisks(current.risks),
      suggestions: summarizeSuggestions(current.suggestions),
    },
    history: selectedHistory.map((record) => ({
      repositoryKey: record.repositoryKey,
      prNumber: record.prNumber,
      prUrl: record.prUrl || "",
      title: record.title || "",
      analyzedAt: record.analyzedAt || "",
      summary: summarizeSummary(record.summary),
      risks: summarizeRisks(record.risks),
      suggestions: summarizeSuggestions(record.suggestions),
      patchDigest: summarizePatchDigest(record.patchDigest),
    })),
  };
}

export function buildHistoryComparisonMessages(context) {
  return [
    {
      role: "system",
      content:
        "你是一个谨慎的 Pull Request 历史上下文分析助手。你只能基于提供的当前 PR 分析结果和同仓库历史 PR 摘要做对比，不要编造仓库背景、未提供的文件内容或外部事实。历史 PR 只是上下文补充，不能替代当前 PR 证据。请输出 JSON，不要输出 Markdown。",
    },
    {
      role: "user",
      content: [
        "请对当前 PR 和同仓库历史 PR 做对比分析。",
        "",
        "上下文 JSON：",
        JSON.stringify(context, null, 2),
        "",
        "请输出 JSON 对象：",
        '{"comparedPrs":[{"number":1,"title":"历史 PR 标题","relation":"与当前 PR 的关系"}],"impactAnalysis":["当前 PR 对历史功能或模块的影响"],"repeatedRisks":["重复出现或相似的历史风险"],"reviewFocus":["建议 reviewer 重点检查的内容"],"contextNotes":["使用了哪些历史上下文以及限制"],"confidence":0.0}',
        "如果没有足够证据，请降低 confidence，并在 contextNotes 中说明限制。",
      ].join("\n"),
    },
  ];
}

export function parseHistoryComparisonResponse(content, context) {
  try {
    const parsed = JSON.parse(cleanJsonText(content));

    return {
      repository: context.repository,
      mode: context.mode || "compare-with-history",
      currentPr: context.currentPr,
      comparedPrs: Array.isArray(parsed.comparedPrs)
        ? parsed.comparedPrs.map((item) => ({
            number: Number(item.number) || null,
            title: String(item.title || ""),
            relation: String(item.relation || ""),
          }))
        : [],
      impactAnalysis: normalizeList(parsed.impactAnalysis),
      repeatedRisks: normalizeList(parsed.repeatedRisks),
      reviewFocus: normalizeList(parsed.reviewFocus),
      contextNotes: normalizeList(parsed.contextNotes),
      confidence: normalizeConfidence(parsed.confidence),
    };
  } catch {
    throw new HistoryComparisonError(
      "HISTORY_COMPARISON_PARSE_ERROR",
      "DeepSeek 返回内容不是有效历史对比 JSON。",
      502,
    );
  }
}

export async function requestHistoryComparison(payload = {}, options = {}) {
  const context = buildHistoryComparisonContext(
    {
      ...payload.current,
      mode: payload.mode || "compare-with-history",
    },
    payload.history || [],
    options,
  );

  if (!context.history.length) {
    throw new HistoryComparisonError("NO_RELATED_HISTORY", "没有可用于对比的同仓库历史记录。", 400);
  }

  /**
   * 历史对比通常会携带更多上下文，优先使用单独的大上下文 API Key。
   * 如果用户没有配置专用 Key，则回退普通分析 Key，保证本地演示时不必重复配置。
   */
  const apiKey =
    options.apiKey !== undefined ? options.apiKey : process.env.DEEPSEEK_CONTEXT_API_KEY || process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new HistoryComparisonError(
      "HISTORY_COMPARISON_CONFIG_ERROR",
      "缺少 DeepSeek API Key，请先配置模型密钥。",
      400,
    );
  }

  const baseUrl = options.baseUrl || process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const model =
    options.model || process.env.DEEPSEEK_CONTEXT_MODEL || process.env.DEEPSEEK_MODEL || DEFAULT_CONTEXT_MODEL || DEFAULT_MODEL;
  const fetcher = options.fetcher || fetch;
  const response = await fetcher(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildHistoryComparisonMessages(context),
      response_format: { type: "json_object" },
      temperature: 0,
      stream: false,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new HistoryComparisonError(
      "HISTORY_COMPARISON_API_ERROR",
      data?.error?.message || "DeepSeek 历史对比分析调用失败，请检查 API Key、模型名称或网络状态。",
      response.status,
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new HistoryComparisonError("HISTORY_COMPARISON_API_ERROR", "DeepSeek 没有返回可用的历史对比内容。", 502);
  }

  return {
    comparison: parseHistoryComparisonResponse(content, context),
  };
}
