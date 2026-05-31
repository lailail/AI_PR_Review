const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_MAX_RISK_FILES = 20;
const DEFAULT_MAX_PATCH_LENGTH = 2000;

const RISK_PATTERNS = [
  { label: "权限/鉴权", keywords: ["auth", "permission", "role", "token", "session", "login"] },
  { label: "数据读写", keywords: ["db", "database", "sql", "query", "migration", "schema"] },
  { label: "接口输入", keywords: ["api", "route", "controller", "handler", "request", "validate"] },
  { label: "配置/依赖", keywords: ["config", "env", "docker", "ci", "workflow", "package.json", "lock"] },
  { label: "测试变化", keywords: ["test", "spec", "__tests__"] },
];

const PATCH_RISK_KEYWORDS = [
  { label: "潜在安全风险", keyword: "dangerouslySetInnerHTML" },
  { label: "潜在安全风险", keyword: "eval(" },
  { label: "待确认实现", keyword: "TODO" },
  { label: "待确认实现", keyword: "FIXME" },
  { label: "类型放宽", keyword: "any" },
];

const DOCUMENTATION_FILE_PATTERN = /(^|\/)(readme|docs?\/|changelog|contributing)|\.(md|mdx|txt)$/i;
const CUSTOM_ERROR_SUPER_CODE_PATTERN = /class\s+\w*Error\s+extends\s+Error[\s\S]*?super\(\s*(code|status|errorCode)\s*\)/i;

export class RiskDetectionError extends Error {
  constructor(code, message, status = 500) {
    super(message);
    this.name = "RiskDetectionError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

function includesKeyword(value, keyword) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

function includesPatchRiskKeyword(value, keyword) {
  if (keyword === "any") {
    return /\bany\b/i.test(value);
  }

  return includesKeyword(value, keyword);
}

function unique(values) {
  return [...new Set(values)];
}

function isDocumentationFile(filename = "") {
  return DOCUMENTATION_FILE_PATTERN.test(filename);
}

function hasCustomErrorMessageRisk(patch = "") {
  return CUSTOM_ERROR_SUPER_CODE_PATTERN.test(patch);
}

/**
 * 规则预筛选只用于提示风险方向，不直接当作最终风险结论。
 * 这样可以让 DeepSeek 聚焦高风险文件，同时避免把关键词命中误当成真实问题。
 */
export function detectRuleSignals(files) {
  return files
    .map((file) => {
      const textForMatch = `${file.filename}\n${file.patch || ""}`;
      const labels = [];
      const reasons = [];
      const matchedDocumentationLabels = [];

      for (const pattern of RISK_PATTERNS) {
        if (pattern.keywords.some((keyword) => includesKeyword(textForMatch, keyword))) {
          if (isDocumentationFile(file.filename)) {
            matchedDocumentationLabels.push(pattern.label);
          } else {
            labels.push(pattern.label);
            reasons.push(`命中 ${pattern.label} 相关关键词`);
          }
        }
      }

      if (!isDocumentationFile(file.filename) && file.status === "removed" && includesKeyword(file.filename, "test")) {
        labels.push("测试变化");
        reasons.push("删除了测试文件");
      }

      if (!isDocumentationFile(file.filename) && file.changes >= 300) {
        labels.push("大改动");
        reasons.push(`单文件变更 ${file.changes} 行，超过 300 行阈值`);
      }

      if (!isDocumentationFile(file.filename)) {
        for (const patchRisk of PATCH_RISK_KEYWORDS) {
          if (file.patch && includesPatchRiskKeyword(file.patch, patchRisk.keyword)) {
            labels.push(patchRisk.label);
            reasons.push(`patch 中出现 ${patchRisk.keyword}`);
          }
        }
      }

      if (!isDocumentationFile(file.filename) && hasCustomErrorMessageRisk(file.patch || "")) {
        labels.push("错误处理");
        reasons.push("检测到自定义 Error 类调用 super(code)，可能导致 Error.message 不可读");
      }

      if (isDocumentationFile(file.filename) && matchedDocumentationLabels.length > 0) {
        labels.push("文档说明");
        reasons.push(`文档内容提到 ${unique(matchedDocumentationLabels).join("、")} 相关关键词`);
      }

      if (labels.length === 0) {
        return null;
      }

      return {
        file: file.filename,
        labels: unique(labels),
        reason: unique(reasons).join("；"),
      };
    })
    .filter(Boolean);
}

/**
 * 给文件计算简单风险分数，分数只用于上下文排序。
 * 配置、鉴权、接口、测试删除和大改动优先发送给模型，以提升响应速度和有效上下文密度。
 */
export function scoreRiskFile(file, ruleSignals) {
  const signal = ruleSignals.find((item) => item.file === file.filename);
  let score = signal ? signal.labels.length * 10 : 0;

  if (signal?.labels.includes("权限/鉴权")) score += 20;
  if (signal?.labels.includes("数据读写")) score += 18;
  if (signal?.labels.includes("配置/依赖")) score += 14;
  if (signal?.labels.includes("错误处理")) score += 16;
  if (signal?.labels.includes("文档说明")) score -= 20;
  if (file.status === "removed") score += 10;
  if (file.changes >= 300) score += 12;
  if (isDocumentationFile(file.filename)) score -= 20;

  return score;
}

function truncatePatchForRisk(patch = "", maxLength = DEFAULT_MAX_PATCH_LENGTH) {
  if (!patch) {
    return "该文件没有可展示的 patch，可能是二进制文件、删除文件或变更过大。";
  }

  if (patch.length <= maxLength) {
    return patch;
  }

  return `${patch.slice(0, maxLength)}\n...（patch 已截断，仅保留前 ${maxLength} 个字符用于风险识别）`;
}

/**
 * 构造风险识别上下文。
 * 优先保留规则命中的高风险文件，并限制 patch 长度，降低请求成本和模型噪声。
 */
export function buildRiskDetectionContext(pr, files, ruleSignals, options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_RISK_FILES;
  const maxPatchLength = options.maxPatchLength ?? DEFAULT_MAX_PATCH_LENGTH;
  const orderedFiles = [...files]
    .sort((a, b) => scoreRiskFile(b, ruleSignals) - scoreRiskFile(a, ruleSignals))
    .slice(0, maxFiles);
  const hiddenFileCount = Math.max(files.length - orderedFiles.length, 0);
  const signalText = ruleSignals.length
    ? ruleSignals.map((signal) => `- ${signal.file}: ${signal.labels.join("、")}；${signal.reason}`).join("\n")
    : "未命中明显规则信号。";
  const fileText = orderedFiles
    .map((file, index) => {
      const signal = ruleSignals.find((item) => item.file === file.filename);

      return [
        `${index + 1}. ${file.filename}`,
        `状态：${file.status}`,
        `变更规模：+${file.additions} / -${file.deletions}，共 ${file.changes} 行`,
        `规则标签：${signal ? signal.labels.join("、") : "无"}`,
        "Patch:",
        truncatePatchForRisk(file.patch, maxPatchLength),
      ].join("\n");
    })
    .join("\n\n");

  return [
    "请基于以下 Pull Request 元数据、规则预筛选信号和 diff 内容识别风险代码变更。",
    "",
    "PR 信息：",
    `标题：${pr.title || "未提供"}`,
    `描述：${pr.body || "未填写 PR 描述"}`,
    `仓库：${pr.owner}/${pr.repo}`,
    `编号：#${pr.number}`,
    `变更规模：+${pr.additions} / -${pr.deletions}，${pr.changedFiles} 个文件`,
    "",
    "规则预筛选信号：",
    signalText,
    "",
    "待分析文件：",
    fileText,
    hiddenFileCount > 0 ? `\n其余 ${hiddenFileCount} 个文件未放入模型上下文，用于控制响应速度和成本。` : "",
    "",
    "请只输出有 diff 证据支撑的风险。没有证据的猜测不要输出。",
  ].join("\n");
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

function isExternalAvailabilityClaim(risk) {
  const combinedText = `${risk.category}\n${risk.file}\n${risk.evidence}\n${risk.reason}\n${risk.suggestion}`.toLowerCase();
  const mentionsExternalTarget =
    combinedText.includes("deepseek_model") ||
    combinedText.includes("模型名") ||
    combinedText.includes("model") ||
    combinedText.includes("依赖版本") ||
    combinedText.includes("dependency version");
  const makesAvailabilityClaim =
    combinedText.includes("不存在") ||
    combinedText.includes("不支持") ||
    combinedText.includes("可能不存在") ||
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
 * 解析 DeepSeek 返回的风险 JSON。
 * 缺少证据、文件路径或建议的条目会被过滤，减少空泛 AI 评论带来的误报。
 */
export function parseRiskDetectionResponse(text) {
  try {
    const parsed = JSON.parse(cleanJsonText(text));
    const risks = Array.isArray(parsed.risks) ? parsed.risks : [];

    return risks
      .map((risk) => ({
        severity: normalizeSeverity(risk.severity),
        category: String(risk.category || "未分类"),
        file: String(risk.file || ""),
        evidence: String(risk.evidence || ""),
        reason: String(risk.reason || ""),
        suggestion: String(risk.suggestion || ""),
        confidence: Number.isFinite(Number(risk.confidence)) ? Math.max(0, Math.min(1, Number(risk.confidence))) : 0.5,
      }))
      .filter((risk) => risk.file && risk.evidence && risk.reason && risk.suggestion)
      // 误报控制：模型名、依赖版本是否真实存在属于外部事实，不能仅凭模型记忆判断。
      .filter((risk) => !isExternalAvailabilityClaim(risk));
  } catch {
    throw new RiskDetectionError("RISK_DETECTION_PARSE_ERROR", "DeepSeek 返回内容不是有效风险 JSON。", 502);
  }
}

function buildRiskMessages(context) {
  return [
    {
      role: "system",
      content:
        "你是一个谨慎的代码评审助手，任务是识别 Pull Request 中可能需要人工重点检查的风险。你只能根据提供的 PR 元数据、规则信号和 diff 内容判断，不要编造未出现的信息。不要依赖外部知识断言某个依赖、模型名、API 或配置一定不存在；除非 diff 本身提供了明确证据。请输出 JSON，不要输出 Markdown。低置信度问题必须标记较低 confidence。",
    },
    {
      role: "user",
      content: [
        context,
        "",
        "请输出 JSON 对象：",
        '{"risks":[{"severity":"high|medium|low","category":"风险类别","file":"文件路径","evidence":"来自 diff 的证据","reason":"为什么这是风险","suggestion":"建议 reviewer 如何检查或修复","confidence":0.0}]}',
        "不要把“模型名可能不存在”“依赖版本可能不存在”这类外部事实作为风险，除非当前 diff 中已经展示了失败日志或明确错误。",
        "如果没有发现明显风险，返回 {\"risks\":[]}。",
      ].join("\n"),
    },
  ];
}

/**
 * 调用 DeepSeek 识别风险代码。
 * DeepSeek API Key 只从服务端环境变量读取，避免泄露到前端和 GitHub 仓库。
 */
export async function requestRiskDetection(pr, files) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new RiskDetectionError(
      "RISK_DETECTION_CONFIG_MISSING",
      "缺少 DeepSeek API Key，请在本地 .env.local 中配置 DEEPSEEK_API_KEY。",
      400,
    );
  }

  const ruleSignals = detectRuleSignals(files);
  const context = buildRiskDetectionContext(pr, files, ruleSignals);
  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildRiskMessages(context),
      response_format: { type: "json_object" },
      temperature: 0,
      stream: false,
    }),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new RiskDetectionError(
      "RISK_DETECTION_API_ERROR",
      data?.error?.message || "DeepSeek 风险识别调用失败，请检查 API Key、模型名称或网络状态。",
      response.status,
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new RiskDetectionError("RISK_DETECTION_API_ERROR", "DeepSeek 没有返回可用的风险识别内容。", 502);
  }

  return {
    risks: parseRiskDetectionResponse(content),
    ruleSignals,
  };
}
