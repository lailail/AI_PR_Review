import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildRiskDetectionContext,
  detectRuleSignals,
  parseRiskDetectionResponse,
  requestRiskDetection,
  RiskDetectionError,
} from "../lib/risk-detection";

const samplePr = {
  owner: "lailail",
  repo: "AI_PR_Review",
  number: 4,
  title: "Add risk detection",
  body: "Identify risky PR changes.",
  additions: 360,
  deletions: 40,
  changedFiles: 3,
};

const sampleFiles = [
  {
    filename: "app/api/auth/route.js",
    status: "modified",
    additions: 40,
    deletions: 8,
    changes: 48,
    patch: "@@ -1 +1 @@\n+const token = request.headers.get('authorization')",
  },
  {
    filename: "package.json",
    status: "modified",
    additions: 3,
    deletions: 1,
    changes: 4,
    patch: "@@ -1 +1 @@\n+\"new-lib\": \"latest\"",
  },
  {
    filename: "tests/user.test.js",
    status: "removed",
    additions: 0,
    deletions: 80,
    changes: 80,
    patch: "",
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("detectRuleSignals", () => {
  test("marks API auth files with interface and auth risk labels", () => {
    const signals = detectRuleSignals([sampleFiles[0]]);

    expect(signals[0].file).toBe("app/api/auth/route.js");
    expect(signals[0].labels).toContain("接口输入");
    expect(signals[0].labels).toContain("权限/鉴权");
  });

  test("marks dependency and removed test files", () => {
    const signals = detectRuleSignals(sampleFiles);

    expect(signals.find((signal) => signal.file === "package.json").labels).toContain("配置/依赖");
    expect(signals.find((signal) => signal.file === "tests/user.test.js").labels).toContain("测试变化");
  });
});

describe("buildRiskDetectionContext", () => {
  test("includes PR metadata, rule signals, and prioritized risky files", () => {
    const signals = detectRuleSignals(sampleFiles);
    const context = buildRiskDetectionContext(samplePr, sampleFiles, signals, {
      maxFiles: 2,
      maxPatchLength: 200,
    });

    expect(context).toContain("Add risk detection");
    expect(context).toContain("规则预筛选信号");
    expect(context).toContain("app/api/auth/route.js");
    expect(context).toContain("package.json");
    expect(context).not.toContain("tests/user.test.js\n状态");
  });
});

describe("parseRiskDetectionResponse", () => {
  test("parses valid risk JSON and keeps complete risk items", () => {
    const result = parseRiskDetectionResponse(
      JSON.stringify({
        risks: [
          {
            severity: "high",
            category: "权限/鉴权",
            file: "app/api/auth/route.js",
            evidence: "新增 token 读取逻辑",
            reason: "涉及鉴权输入但缺少校验说明",
            suggestion: "确认 token 校验和失败路径",
            confidence: 0.82,
          },
        ],
      }),
    );

    expect(result).toEqual([
      {
        severity: "high",
        category: "权限/鉴权",
        file: "app/api/auth/route.js",
        evidence: "新增 token 读取逻辑",
        reason: "涉及鉴权输入但缺少校验说明",
        suggestion: "确认 token 校验和失败路径",
        confidence: 0.82,
      },
    ]);
  });

  test("filters risk items without evidence", () => {
    const result = parseRiskDetectionResponse(
      JSON.stringify({
        risks: [
          {
            severity: "medium",
            category: "接口输入",
            file: "app/api/user/route.js",
            evidence: "",
            reason: "可能有问题",
            suggestion: "检查一下",
            confidence: 0.4,
          },
        ],
      }),
    );

    expect(result).toEqual([]);
  });

  test("filters model availability claims based on external knowledge", () => {
    const result = parseRiskDetectionResponse(
      JSON.stringify({
        risks: [
          {
            severity: "medium",
            category: "配置/依赖",
            file: ".env.local.example",
            evidence: "DEEPSEEK_MODEL=deepseek-v4-flash",
            reason: "模型名可能不存在",
            suggestion: "改成 deepseek-chat",
            confidence: 0.8,
          },
        ],
      }),
    );

    expect(result).toEqual([]);
  });

  test("parses JSON wrapped in markdown code fences", () => {
    const result = parseRiskDetectionResponse(`\`\`\`json
{"risks":[]}
\`\`\``);

    expect(result).toEqual([]);
  });

  test("throws a typed error for invalid JSON", () => {
    expect(() => parseRiskDetectionResponse("not json")).toThrow(RiskDetectionError);
  });
});

describe("requestRiskDetection", () => {
  test("requires a local DeepSeek API key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    await expect(requestRiskDetection(samplePr, sampleFiles)).rejects.toMatchObject({
      code: "RISK_DETECTION_CONFIG_MISSING",
    });
  });
});
