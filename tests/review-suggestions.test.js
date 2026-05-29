import { afterEach, describe, expect, test, vi } from "vitest";
import {
  buildReviewSuggestionContext,
  formatReviewMarkdown,
  parseReviewSuggestionResponse,
  requestReviewSuggestions,
  ReviewSuggestionError,
} from "../lib/review-suggestions";

const samplePr = {
  owner: "lailail",
  repo: "AI_PR_Review",
  number: 5,
  title: "Add review suggestions",
  author: "octocat",
  body: "Generate structured review suggestions.",
  additions: 180,
  deletions: 32,
  changedFiles: 2,
};

const sampleFiles = [
  {
    filename: "app/api/user/route.js",
    status: "modified",
    additions: 42,
    deletions: 6,
    changes: 48,
    patch: "@@ -20,6 +20,9 @@\n+const body = await request.json()\n+return saveUser(body)",
  },
  {
    filename: "README.md",
    status: "modified",
    additions: 20,
    deletions: 2,
    changes: 22,
    patch: "@@ -1 +1 @@\n+Updated docs",
  },
];

const sampleSummary = {
  overview: "Adds review suggestions.",
  businessChanges: ["Users can generate Review suggestions."],
  technicalChanges: ["Adds a new API route."],
  testChanges: ["Adds unit tests."],
  impactScope: ["PR review workflow."],
  reviewFocus: ["Input validation."],
};

const sampleRisks = [
  {
    severity: "medium",
    category: "接口输入",
    file: "app/api/user/route.js",
    evidence: "request.json() 直接传入 saveUser",
    reason: "缺少输入校验",
    suggestion: "补充必填字段和类型校验",
    confidence: 0.78,
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildReviewSuggestionContext", () => {
  test("includes PR metadata, summary, risks, and prioritized patches", () => {
    const context = buildReviewSuggestionContext(samplePr, sampleFiles, sampleSummary, sampleRisks, {
      maxFiles: 1,
      maxPatchLength: 200,
    });

    expect(context).toContain("Add review suggestions");
    expect(context).toContain("Adds review suggestions.");
    expect(context).toContain("request.json() 直接传入 saveUser");
    expect(context).toContain("app/api/user/route.js");
    expect(context).not.toContain("README.md\n状态");
    expect(context).toContain("其余 1 个文件未放入模型上下文");
  });
});

describe("parseReviewSuggestionResponse", () => {
  test("parses valid review suggestion JSON", () => {
    const suggestions = parseReviewSuggestionResponse(
      JSON.stringify({
        suggestions: [
          {
            severity: "medium",
            file: "app/api/user/route.js",
            line: "24",
            problem: "缺少输入校验",
            suggestion: "补充字段校验和异常路径测试",
            confidence: 0.82,
          },
        ],
      }),
    );

    expect(suggestions).toEqual([
      {
        severity: "medium",
        file: "app/api/user/route.js",
        line: 24,
        problem: "缺少输入校验",
        suggestion: "补充字段校验和异常路径测试",
        confidence: 0.82,
      },
    ]);
  });

  test("filters incomplete suggestions", () => {
    const suggestions = parseReviewSuggestionResponse(
      JSON.stringify({
        suggestions: [
          {
            severity: "high",
            file: "",
            line: null,
            problem: "可能有问题",
            suggestion: "检查一下",
            confidence: 0.9,
          },
        ],
      }),
    );

    expect(suggestions).toEqual([]);
  });

  test("normalizes invalid severity, line, and confidence", () => {
    const suggestions = parseReviewSuggestionResponse(
      JSON.stringify({
        suggestions: [
          {
            severity: "critical",
            file: "app/page.js",
            line: "not-a-number",
            problem: "按钮重复请求",
            suggestion: "加载中禁用按钮",
            confidence: 2,
          },
        ],
      }),
    );

    expect(suggestions[0]).toMatchObject({
      severity: "low",
      line: null,
      confidence: 1,
    });
  });

  test("parses JSON wrapped in markdown code fences", () => {
    const suggestions = parseReviewSuggestionResponse(`\`\`\`json
{"suggestions":[]}
\`\`\``);

    expect(suggestions).toEqual([]);
  });

  test("throws a typed error for invalid JSON", () => {
    expect(() => parseReviewSuggestionResponse("not json")).toThrow(ReviewSuggestionError);
  });
});

describe("formatReviewMarkdown", () => {
  test("formats suggestions into GitHub friendly markdown", () => {
    const markdown = formatReviewMarkdown(
      [
        {
          severity: "medium",
          file: "app/api/user/route.js",
          line: 24,
          problem: "缺少输入校验",
          suggestion: "补充字段校验和异常路径测试",
          confidence: 0.82,
        },
      ],
      sampleSummary,
      sampleRisks,
    );

    expect(markdown).toContain("## AI Review 建议");
    expect(markdown).toContain("app/api/user/route.js:24");
    expect(markdown).toContain("缺少输入校验");
    expect(markdown).toContain("82%");
  });

  test("marks low confidence suggestions for manual confirmation", () => {
    const markdown = formatReviewMarkdown([
      {
        severity: "low",
        file: "app/page.js",
        line: null,
        problem: "交互提示可能不够明确",
        suggestion: "人工确认是否需要调整文案",
        confidence: 0.32,
      },
    ]);

    expect(markdown).toContain("需要人工确认");
  });

  test("formats an empty result", () => {
    const markdown = formatReviewMarkdown([]);

    expect(markdown).toContain("未发现明确需要提出的 Review 建议");
  });
});

describe("requestReviewSuggestions", () => {
  test("requires a local DeepSeek API key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    await expect(requestReviewSuggestions(samplePr, sampleFiles, sampleSummary, sampleRisks)).rejects.toMatchObject({
      code: "REVIEW_SUGGESTION_CONFIG_MISSING",
    });
  });
});
