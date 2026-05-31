const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_MAX_REVIEW_FILES = 20;
const DEFAULT_MAX_PATCH_LENGTH = 2000;
const LOW_CONFIDENCE_THRESHOLD = 0.5;

export class ReviewSuggestionError extends Error {
  constructor(code, message, status = 500) {
    super(code);
    this.name = "ReviewSuggestionError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

function cleanJsonText(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
}

function normalizeSeverity(value) {
  return ["high", "medium", "low"].includes(value) ? value : "low";
}

function normalizeConfidence(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0.5;
}

function normalizeLine(value) {
  const line = Number(value);

  return Number.isInteger(line) && line > 0 ? line : null;
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

function truncatePatchForReview(patch = "", maxLength = DEFAULT_MAX_PATCH_LENGTH) {
  if (!patch) {
    return "该文件没有可展示的 patch，可能是二进制文件、删除文件或变更过大。";
  }

  if (patch.length <= maxLength) {
    return patch;
  }

  return `${patch.slice(0, maxLength)}\n...（patch 已截断，仅保留前 ${maxLength} 个字符用于 Review 建议）`;
}

function scoreReviewFile(file, risks) {
  const risk = risks.find((item) => item.file === file.filename);
  let score = risk ? 30 + Math.round((risk.confidence || 0) * 20) : 0;

  if (risk?.severity === "high") score += 20;
  if (risk?.severity === "medium") score += 12;
  if (file.filename.includes("api") || file.filename.includes("route")) score += 10;
  if (file.filename.includes("auth") || file.filename.includes("token")) score += 14;
  if (file.filename.includes("package") || file.filename.includes("config")) score += 8;
  if (file.changes >= 300) score += 12;

  return score;
}

function formatSummaryForContext(summary = {}) {
  const sections = [
    ["概览", normalizeList(summary.overview)],
    ["业务变化", normalizeList(summary.businessChanges)],
    ["技术变化", normalizeList(summary.technicalChanges)],
    ["测试变化", normalizeList(summary.testChanges || summary.testingChanges)],
    ["影响范围", normalizeList(summary.impactScope)],
    ["Review 关注点", normalizeList(summary.reviewFocus)],
  ];

  return sections
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => `${title}：${items.join("；")}`)
    .join("\n");
}

function formatRisksForContext(risks = []) {
  if (!risks.length) {
    return "未提供风险识别结果。";
  }

  return risks
    .map((risk, index) => {
      return [
        `${index + 1}. ${risk.file}`,
        `等级：${risk.severity}`,
        `类别：${risk.category || "未分类"}`,
        `证据：${risk.evidence || "未提供"}`,
        `原因：${risk.reason || "未提供"}`,
        `建议：${risk.suggestion || "未提供"}`,
        `置信度：${Math.round((risk.confidence || 0) * 100)}%`,
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * 构造 Review 建议上下文。
 * 这里合并 PR 元数据、总结、风险识别和高风险 patch，让模型围绕已有证据给出建议；
 * 同时限制文件数量和 patch 长度，避免大 PR 造成响应慢、成本高或模型注意力分散。
 */
export function buildReviewSuggestionContext(pr, files, summary = {}, risks = [], options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_REVIEW_FILES;
  const maxPatchLength = options.maxPatchLength ?? DEFAULT_MAX_PATCH_LENGTH;
  const orderedFiles = [...files]
    .sort((a, b) => scoreReviewFile(b, risks) - scoreReviewFile(a, risks))
    .slice(0, maxFiles);
  const hiddenFileCount = Math.max(files.length - orderedFiles.length, 0);
  const fileText = orderedFiles
    .map((file, index) => {
      const relatedRisk = risks.find((risk) => risk.file === file.filename);

      return [
        `${index + 1}. ${file.filename}`,
        `状态：${file.status}`,
        `变更规模：+${file.additions} / -${file.deletions}，共 ${file.changes} 行`,
        `关联风险：${relatedRisk ? `${relatedRisk.severity} - ${relatedRisk.reason}` : "无"}`,
        "Patch:",
        truncatePatchForReview(file.patch, maxPatchLength),
      ].join("\n");
    })
    .join("\n\n");

  return [
    "请基于以下 Pull Request 信息、AI 总结、风险识别结果和 diff 内容生成 Review 建议。",
    "",
    "PR 信息：",
    `标题：${pr.title || "未提供"}`,
    `描述：${pr.body || "未填写 PR 描述"}`,
    `仓库：${pr.owner}/${pr.repo}`,
    `编号：#${pr.number}`,
    `作者：${pr.author || "未知"}`,
    `变更规模：+${pr.additions} / -${pr.deletions}，${pr.changedFiles} 个文件`,
    "",
    "AI 变更总结：",
    formatSummaryForContext(summary) || "未提供 AI 变更总结。",
    "",
    "风险识别结果：",
    formatRisksForContext(risks),
    "",
    "待分析文件：",
    fileText,
    hiddenFileCount > 0 ? `\n其余 ${hiddenFileCount} 个文件未放入模型上下文，用于控制响应速度和成本。` : "",
    "",
    "请只输出当前上下文证据支持的 Review 建议。没有证据的猜测不要输出。",
  ].join("\n");
}

function isExternalAvailabilityClaim(suggestion) {
  const combinedText = `${suggestion.file}\n${suggestion.problem}\n${suggestion.suggestion}`.toLowerCase();
  const mentionsExternalTarget =
    combinedText.includes("deepseek_model") ||
    combinedText.includes("模型名") ||
    combinedText.includes("model") ||
    combinedText.includes("依赖版本") ||
    combinedText.includes("dependency version");
  const makesAvailabilityClaim =
    combinedText.includes("不存在") ||
    combinedText.includes("不支持") ||
    combinedText.includes("not exist") ||
    combinedText.includes("unsupported") ||
    combinedText.includes("deepseek-chat") ||
    combinedText.includes("deepseek-coder");
  const hasRuntimeFailureEvidence =
    combinedText.includes("error") ||
    combinedText.includes("failed") ||
    combinedText.includes("失败") ||
    combinedText.includes("报错") ||
    combinedText.includes("日志");

  return mentionsExternalTarget && makesAvailabilityClaim && !hasRuntimeFailureEvidence;
}

/**
 * 解析 DeepSeek 返回的 Review 建议 JSON。
 * 字段不完整、缺少文件路径或建议内容的条目会被过滤；低置信度建议保留给前端开关控制，
 * 不在解析阶段直接丢弃，避免漏掉值得人工确认的线索。
 */
export function parseReviewSuggestionResponse(text) {
  try {
    const parsed = JSON.parse(cleanJsonText(text));
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

    return suggestions
      .map((suggestion) => ({
        severity: normalizeSeverity(suggestion.severity),
        file: String(suggestion.file || ""),
        line: normalizeLine(suggestion.line),
        problem: String(suggestion.problem || ""),
        suggestion: String(suggestion.suggestion || ""),
        confidence: normalizeConfidence(suggestion.confidence),
      }))
      .filter((suggestion) => suggestion.file && suggestion.problem && suggestion.suggestion)
      // 误报控制：依赖、模型或 API 是否存在不能只靠模型记忆判断，必须有 diff 中的失败证据。
      .filter((suggestion) => !isExternalAvailabilityClaim(suggestion));
  } catch {
    throw new ReviewSuggestionError("REVIEW_SUGGESTION_PARSE_ERROR", "DeepSeek 返回内容不是有效 Review 建议 JSON。", 502);
  }
}

function getSeverityLabel(severity) {
  const labelMap = {
    high: "高",
    medium: "中",
    low: "低",
  };

  return labelMap[severity] || "低";
}

function formatSuggestionLocation(suggestion) {
  return suggestion.line ? `${suggestion.file}:${suggestion.line}` : suggestion.file;
}

function formatFocusList(summary = {}, risks = []) {
  const reviewFocus = normalizeList(summary.reviewFocus);
  const riskFocus = risks.slice(0, 3).map((risk) => `${risk.file}（${risk.category || risk.severity}）`);
  const focusItems = [...reviewFocus, ...riskFocus];

  if (!focusItems.length) {
    return "- 建议重点关注变更范围、测试覆盖和业务影响。";
  }

  return focusItems.map((item) => `- ${item}`).join("\n");
}

/**
 * 将结构化建议格式化为 GitHub PR 评论区可直接粘贴的 Markdown。
 * Markdown 输出要保留证据位置、置信度和低置信度提示，避免 AI 建议被误当成确定结论。
 */
export function formatReviewMarkdown(suggestions = [], summary = {}, risks = []) {
  if (!suggestions.length) {
    return [
      "## AI Review 建议",
      "",
      "未发现明确需要提出的 Review 建议。建议 reviewer 仍关注 PR 变更范围、测试覆盖和业务影响。",
    ].join("\n");
  }

  const overview = summary?.overview || "本次 Review 建议基于 PR diff、AI 总结和风险识别结果生成。";
  const suggestionBlocks = suggestions.map((suggestion, index) => {
    const confidenceText = `${Math.round(suggestion.confidence * 100)}%`;
    const lowConfidenceNote =
      suggestion.confidence < LOW_CONFIDENCE_THRESHOLD ? "\n\n**提示：** 低置信度，需要人工确认后再处理。" : "";

    return [
      `#### ${index + 1}. [${getSeverityLabel(suggestion.severity)}] ${formatSuggestionLocation(suggestion)}`,
      "",
      `**问题：** ${suggestion.problem}`,
      "",
      `**建议：** ${suggestion.suggestion}`,
      "",
      `**置信度：** ${confidenceText}${lowConfidenceNote}`,
    ].join("\n");
  });

  return [
    "## AI Review 建议",
    "",
    "### 总体结论",
    "",
    `- 本次 PR 主要变更：${overview}`,
    "- 建议重点关注：",
    formatFocusList(summary, risks),
    "",
    "### Review 建议",
    "",
    suggestionBlocks.join("\n\n"),
    "",
    "### 风险提示",
    "",
    "- AI 建议仅基于当前可见 diff 和上下文生成，低置信度建议不应直接作为阻塞结论。",
  ].join("\n");
}

function buildReviewMessages(context) {
  return [
    {
      role: "system",
      content:
        "你是一个谨慎的 Pull Request 代码评审助手。你只能基于提供的 PR 信息、diff、变更总结和风险识别结果生成 Review 建议，不要编造未出现的文件、行号、业务背景或外部事实。请输出 JSON，不要输出 Markdown。风格类建议不要作为高严重级别问题，低置信度问题必须降低 confidence。",
    },
    {
      role: "user",
      content: [
        context,
        "",
        "请输出 JSON 对象：",
        '{"suggestions":[{"severity":"high|medium|low","file":"文件路径","line":变更行号或null,"problem":"发现的问题","suggestion":"建议 reviewer 或作者如何处理","confidence":0.0}]}',
        "不要把“模型名可能不存在”“依赖版本可能不存在”这类外部事实作为建议，除非当前 diff 中已经展示了失败日志或明确错误。",
        "如果没有发现值得提出的 Review 建议，返回 {\"suggestions\":[]}。",
      ].join("\n"),
    },
  ];
}

/**
 * 调用 DeepSeek 生成 Review 建议。
 * API Key 只从服务端环境变量读取，前端只能拿到结构化建议和 Markdown，避免密钥泄露到浏览器或仓库。
 */
export async function requestReviewSuggestions(pr, files, summary = {}, risks = []) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new ReviewSuggestionError(
      "REVIEW_SUGGESTION_CONFIG_MISSING",
      "缺少 DeepSeek API Key，请在本地 .env.local 中配置 DEEPSEEK_API_KEY。",
      400,
    );
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const context = buildReviewSuggestionContext(pr, files, summary, risks);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildReviewMessages(context),
      response_format: { type: "json_object" },
      temperature: 0,
      stream: false,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ReviewSuggestionError(
      "REVIEW_SUGGESTION_API_ERROR",
      data?.error?.message || "DeepSeek Review 建议调用失败，请检查 API Key、模型名称或网络状态。",
      response.status,
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new ReviewSuggestionError("REVIEW_SUGGESTION_API_ERROR", "DeepSeek 没有返回可用的 Review 建议内容。", 502);
  }

  const suggestions = parseReviewSuggestionResponse(content);

  return {
    suggestions,
    markdown: formatReviewMarkdown(suggestions, summary, risks),
  };
}
