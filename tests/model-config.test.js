import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  maskApiKey,
  normalizeModelList,
  readLocalModelConfig,
  updateEnvContent,
  updateLocalModelConfig,
} from "../lib/model-config";

let tempDir = null;

function createTempEnv(content = "") {
  tempDir = mkdtempSync(join(tmpdir(), "ai-pr-review-env-"));
  const envPath = join(tempDir, ".env.local");
  writeFileSync(envPath, content, "utf8");

  return envPath;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("maskApiKey", () => {
  test("does not expose the full API key", () => {
    expect(maskApiKey("sk-1234567890abcdef")).toBe("sk-***cdef");
  });

  test("returns an empty string for missing keys", () => {
    expect(maskApiKey("")).toBe("");
  });
});

describe("readLocalModelConfig", () => {
  test("reads DeepSeek config and returns masked key status", () => {
    const envPath = createTempEnv(
      [
        "GITHUB_TOKEN=github-token",
        "DEEPSEEK_API_KEY=sk-1234567890abcdef",
        "DEEPSEEK_MODEL=deepseek-chat",
        "DEEPSEEK_CONTEXT_API_KEY=sk-context-abcdef",
        "DEEPSEEK_CONTEXT_MODEL=deepseek-reasoner",
      ].join("\n"),
    );

    const config = readLocalModelConfig(envPath);

    expect(config).toMatchObject({
      envFileExists: true,
      hasDeepSeekApiKey: true,
      deepSeekApiKeyPreview: "sk-***cdef",
      deepSeekModel: "deepseek-chat",
      hasContextApiKey: true,
      contextApiKeyPreview: "sk-***cdef",
      contextModel: "deepseek-reasoner",
    });
  });

  test("uses safe defaults when env file does not exist", () => {
    const config = readLocalModelConfig(join(tmpdir(), "missing-ai-pr-review.env"));

    expect(config.envFileExists).toBe(false);
    expect(config.hasDeepSeekApiKey).toBe(false);
    expect(config.deepSeekModel).toBe("deepseek-v4-flash");
    expect(config.contextModel).toBe("deepseek-v4-pro");
  });
});

describe("normalizeModelList", () => {
  test("keeps remote models and default DeepSeek model choices", () => {
    const models = normalizeModelList({
      data: [{ id: "deepseek-v4-flash" }, { id: "deepseek-custom" }],
    });

    expect(models).toContain("deepseek-v4-flash");
    expect(models).toContain("deepseek-v4-pro");
    expect(models).toContain("deepseek-custom");
  });
});

describe("updateEnvContent", () => {
  test("updates selected keys and keeps unrelated env values", () => {
    const updated = updateEnvContent(
      ["GITHUB_TOKEN=keep-me", "DEEPSEEK_API_KEY=old-key", "DEEPSEEK_MODEL=old-model"].join("\n"),
      {
        DEEPSEEK_API_KEY: "new-key",
        DEEPSEEK_MODEL: "deepseek-chat",
        DEEPSEEK_CONTEXT_MODEL: "deepseek-reasoner",
      },
    );

    expect(updated).toContain("GITHUB_TOKEN=keep-me");
    expect(updated).toContain("DEEPSEEK_API_KEY=new-key");
    expect(updated).toContain("DEEPSEEK_MODEL=deepseek-chat");
    expect(updated).toContain("DEEPSEEK_CONTEXT_MODEL=deepseek-reasoner");
  });
});

describe("updateLocalModelConfig", () => {
  test("writes DeepSeek config to the env file", () => {
    const envPath = createTempEnv("GITHUB_TOKEN=keep-me\n");

    const config = updateLocalModelConfig(
      {
        deepSeekApiKey: "sk-new-key",
        deepSeekModel: "deepseek-v4-flash",
        contextApiKey: "sk-context-key",
        contextModel: "deepseek-reasoner",
      },
      envPath,
    );

    const savedContent = readFileSync(envPath, "utf8");

    expect(savedContent).toContain("GITHUB_TOKEN=keep-me");
    expect(savedContent).toContain("DEEPSEEK_API_KEY=sk-new-key");
    expect(savedContent).toContain("DEEPSEEK_MODEL=deepseek-v4-flash");
    expect(savedContent).toContain("DEEPSEEK_CONTEXT_API_KEY=sk-context-key");
    expect(config.hasDeepSeekApiKey).toBe(true);
    expect(config.deepSeekApiKeyPreview).toBe("sk-***-key");
  });

  test("keeps existing API keys when key inputs are blank", () => {
    const envPath = createTempEnv(
      ["DEEPSEEK_API_KEY=sk-existing-key", "DEEPSEEK_MODEL=deepseek-v4-flash"].join("\n"),
    );

    updateLocalModelConfig(
      {
        deepSeekApiKey: "",
        deepSeekModel: "deepseek-chat",
        contextApiKey: "",
        contextModel: "deepseek-reasoner",
      },
      envPath,
    );

    const savedContent = readFileSync(envPath, "utf8");

    expect(savedContent).toContain("DEEPSEEK_API_KEY=sk-existing-key");
    expect(savedContent).toContain("DEEPSEEK_MODEL=deepseek-chat");
  });
});
