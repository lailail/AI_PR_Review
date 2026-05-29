const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_PATCH_LENGTH = 1600;

export class AiSummaryError extends Error {
  constructor(code, message, status = 500) {
    super(code);
    this.name = "AiSummaryError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

/**
 * 截断单个文件的 patch。
 * PR diff 可能非常大，限制 patch 长度可以控制 DeepSeek 请求体大小、响应速度和调用成本。
 */
export function truncatePatchForSummary(patch = "", maxLength = DEFAULT_MAX_PATCH_LENGTH) {
  if (!patch) {
    return "该文件没有可展示的 patch，可能是二进制文件或变更过大。";
  }

  if (patch.length <= maxLength) {
    return patch;
  }

  return `${patch.slice(0, maxLength)}\n...（patch 已截断，仅保留前 ${maxLength} 个字符用于总结）`;
}

/**
 * 构造发送给 DeepSeek 的 PR 总结上下文。
 * 这里保留 PR 元数据和有限数量的文件 patch，避免把完整大 diff 直接发送给模型。
 */
export function buildSummaryContext(pr, files, options = {}) {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxPatchLength = options.maxPatchLength ?? DEFAULT_MAX_PATCH_LENGTH;
  const selectedFiles = files.slice(0, maxFiles);
  const hiddenFileCount = Math.max(files.length - selectedFiles.length, 0);
  const fileContexts = selectedFiles.map((file, index) => {
    return [
      `${index + 1}. ${file.filename}`,
      `状态：${file.status}`,
      `变更规模：+${file.additions} / -${file.deletions}，共 ${file.changes} 行`,
      "Patch:",
      truncatePatchForSummary(file.patch, maxPatchLength),
    ].join("\n");
  });

  return [
    "请基于以下 Pull Request 元数据和 diff 内容生成变更总结。",
    "",
    "PR 标题：",
    pr.title || "未提供",
    "",
    "PR 描述：",
    pr.body || "未填写 PR 描述",
    "",
    "PR 信息：",
    `仓库：${pr.owner}/${pr.repo}`,
    `编号：#${pr.number}`,
    `作者：${pr.author}`,
    `变更规模：+${pr.additions} / -${pr.deletions}，${pr.changedFiles} 个文件`,
    "",
    "变更文件：",
    fileContexts.join("\n\n"),
    hiddenFileCount > 0 ? `\n其余 ${hiddenFileCount} 个文件未放入模型上下文，用于控制响应速度和成本。` : "",
    "",
    "请只根据以上信息总结，不要编造 diff 中没有出现的内容。",
  ].join("\n");
}

function normalizeSummaryList(value) {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  return ["未从当前 diff 中发现"];
}

/**
 * 解析 DeepSeek 返回的总结 JSON。
 * 模型有时会把 JSON 包进 markdown 代码块，这里做兼容清理后再解析。
 */
export function parseSummaryResponse(text) {
  const cleanedText = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    const parsed = JSON.parse(cleanedText);

    return {
      overview: String(parsed.overview || "未从当前 diff 中发现明确概览"),
      businessChanges: normalizeSummaryList(parsed.businessChanges),
      technicalChanges: normalizeSummaryList(parsed.technicalChanges),
      testChanges: normalizeSummaryList(parsed.testChanges),
      impactScope: normalizeSummaryList(parsed.impactScope),
      reviewFocus: normalizeSummaryList(parsed.reviewFocus),
    };
  } catch {
    throw new AiSummaryError(
      "DEEPSEEK_RESPONSE_PARSE_ERROR",
      "DeepSeek 返回内容不是有效 JSON，请稍后重试。",
      502,
    );
  }
}

function buildSummaryMessages(context) {
  return [
    {
      role: "system",
      content:
        "你是一个谨慎的代码评审助手。你只能根据提供的 Pull Request 元数据和 diff 内容总结变化，不要编造未出现的信息。请输出 JSON，不要输出 Markdown。",
    },
    {
      role: "user",
      content: [
        context,
        "",
        "请输出一个 JSON 对象，必须包含以下字段：",
        "overview: string",
        "businessChanges: string[]",
        "technicalChanges: string[]",
        "testChanges: string[]",
        "impactScope: string[]",
        "reviewFocus: string[]",
        "如果某一类信息无法从上下文判断，请写“未从当前 diff 中发现”。",
      ].join("\n"),
    },
  ];
}

/**
 * 调用 DeepSeek 生成 PR 变更总结。
 * API Key 只从服务端环境变量读取，避免出现在前端代码或 GitHub 仓库中。
 */
export async function requestPullRequestSummary(pr, files) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    throw new AiSummaryError(
      "DEEPSEEK_CONFIG_MISSING",
      "缺少 DeepSeek API Key，请在本地 .env.local 中配置 DEEPSEEK_API_KEY。",
      400,
    );
  }

  const baseUrl = process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL;
  const model = process.env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const context = buildSummaryContext(pr, files);
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: buildSummaryMessages(context),
      response_format: { type: "json_object" },
      stream: false,
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new AiSummaryError(
      "DEEPSEEK_API_ERROR",
      data?.error?.message || "DeepSeek API 调用失败，请检查 API Key、模型名称或网络状态。",
      response.status,
    );
  }

  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new AiSummaryError("DEEPSEEK_API_ERROR", "DeepSeek 没有返回可用的总结内容。", 502);
  }

  return parseSummaryResponse(content);
}
