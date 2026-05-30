import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ENV_FILE_PATH = join(process.cwd(), ".env.local");
const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_CONTEXT_MODEL = "deepseek-v4-pro";
const DEFAULT_AVAILABLE_MODELS = ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"];

const MODEL_CONFIG_KEYS = [
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_MODEL",
  "DEEPSEEK_CONTEXT_API_KEY",
  "DEEPSEEK_CONTEXT_MODEL",
];

export class ModelConfigError extends Error {
  constructor(code, message, status = 500) {
    super(code);
    this.name = "ModelConfigError";
    this.code = code;
    this.status = status;
    this.clientMessage = message;
  }
}

export function maskApiKey(value = "") {
  const key = String(value).trim();

  if (!key) {
    return "";
  }

  if (key.length <= 8) {
    return "已配置";
  }

  return `${key.slice(0, 3)}***${key.slice(-4)}`;
}

function parseEnvContent(content = "") {
  return content.split(/\r?\n/).reduce((config, line) => {
    const trimmedLine = line.trim();

    if (!trimmedLine || trimmedLine.startsWith("#") || !trimmedLine.includes("=")) {
      return config;
    }

    const equalIndex = line.indexOf("=");
    const key = line.slice(0, equalIndex).trim();
    const value = line.slice(equalIndex + 1).trim();

    config[key] = value;
    return config;
  }, {});
}

function readEnvContent(envFilePath = DEFAULT_ENV_FILE_PATH) {
  if (!existsSync(envFilePath)) {
    return "";
  }

  return readFileSync(envFilePath, "utf8");
}

function normalizeModelConfig(rawConfig, envFileExists) {
  const deepSeekApiKey = rawConfig.DEEPSEEK_API_KEY || "";
  const contextApiKey = rawConfig.DEEPSEEK_CONTEXT_API_KEY || "";

  return {
    envFileExists,
    hasDeepSeekApiKey: Boolean(deepSeekApiKey),
    deepSeekApiKeyPreview: maskApiKey(deepSeekApiKey),
    deepSeekModel: rawConfig.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    hasContextApiKey: Boolean(contextApiKey),
    contextApiKeyPreview: maskApiKey(contextApiKey),
    contextModel: rawConfig.DEEPSEEK_CONTEXT_MODEL || DEFAULT_CONTEXT_MODEL,
    availableModels: DEFAULT_AVAILABLE_MODELS,
  };
}

/**
 * 读取本地模型配置。
 * 接口只返回 API Key 是否存在和脱敏预览，不能把完整密钥返回给前端页面。
 */
export function readLocalModelConfig(envFilePath = DEFAULT_ENV_FILE_PATH) {
  const envFileExists = existsSync(envFilePath);
  const rawConfig = parseEnvContent(readEnvContent(envFilePath));

  return normalizeModelConfig(rawConfig, envFileExists);
}

function normalizeUpdates(updates = {}, currentConfig = {}) {
  const nextDeepSeekApiKey = String(updates.deepSeekApiKey ?? "").trim() || currentConfig.DEEPSEEK_API_KEY || "";
  const nextContextApiKey = String(updates.contextApiKey ?? "").trim() || currentConfig.DEEPSEEK_CONTEXT_API_KEY || "";

  return {
    DEEPSEEK_API_KEY: nextDeepSeekApiKey,
    DEEPSEEK_MODEL: String(updates.deepSeekModel || currentConfig.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL).trim(),
    DEEPSEEK_CONTEXT_API_KEY: nextContextApiKey,
    DEEPSEEK_CONTEXT_MODEL: String(
      updates.contextModel || currentConfig.DEEPSEEK_CONTEXT_MODEL || DEFAULT_CONTEXT_MODEL,
    ).trim(),
  };
}

/**
 * 更新 .env.local 内容。
 * 这里只替换模型配置相关 key，其他环境变量原样保留，避免覆盖用户已有的 GitHub Token 等配置。
 */
export function updateEnvContent(content = "", updates = {}) {
  const normalizedUpdates = Object.fromEntries(
    Object.entries(updates).filter(([key, value]) => MODEL_CONFIG_KEYS.includes(key) && typeof value === "string"),
  );
  const usedKeys = new Set();
  const lines = content ? content.split(/\r?\n/) : [];
  const nextLines = lines.map((line) => {
    const equalIndex = line.indexOf("=");

    if (equalIndex === -1) {
      return line;
    }

    const key = line.slice(0, equalIndex).trim();

    if (!Object.prototype.hasOwnProperty.call(normalizedUpdates, key)) {
      return line;
    }

    usedKeys.add(key);
    return `${key}=${normalizedUpdates[key]}`;
  });

  for (const [key, value] of Object.entries(normalizedUpdates)) {
    if (!usedKeys.has(key)) {
      nextLines.push(`${key}=${value}`);
    }
  }

  return `${nextLines.filter((line, index, array) => line || index < array.length - 1).join("\n").trimEnd()}\n`;
}

export function applyModelConfigToProcess(updates = {}) {
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
}

export function updateLocalModelConfig(updates = {}, envFilePath = DEFAULT_ENV_FILE_PATH) {
  const currentContent = readEnvContent(envFilePath);
  const currentConfig = parseEnvContent(currentContent);
  const normalizedUpdates = normalizeUpdates(updates, currentConfig);
  const nextContent = updateEnvContent(currentContent, normalizedUpdates);

  writeFileSync(envFilePath, nextContent, "utf8");
  applyModelConfigToProcess(normalizedUpdates);

  return readLocalModelConfig(envFilePath);
}

export function normalizeModelList(data) {
  const remoteModels = Array.isArray(data?.data)
    ? data.data.map((model) => model?.id).filter((id) => typeof id === "string" && id.trim())
    : [];

  return [...new Set([...remoteModels, ...DEFAULT_AVAILABLE_MODELS])];
}

/**
 * 使用用户提供的 DeepSeek API Key 拉取账号可用模型。
 * 请求失败时抛出明确错误，前端会保留默认模型列表，避免配置面板不可用。
 */
export async function fetchDeepSeekModels(apiKey, baseUrl = DEFAULT_DEEPSEEK_BASE_URL) {
  if (!apiKey) {
    throw new ModelConfigError("MODEL_CONFIG_API_KEY_MISSING", "请先填写 DeepSeek API Key 后再获取模型列表。", 400);
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ModelConfigError(
      "MODEL_CONFIG_MODEL_LIST_ERROR",
      data?.error?.message || "获取 DeepSeek 模型列表失败，请检查 API Key 是否正确。",
      response.status,
    );
  }

  return normalizeModelList(data);
}
