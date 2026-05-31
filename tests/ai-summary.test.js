import { afterEach, describe, expect, test, vi } from "vitest";
import {
  AiSummaryError,
  buildSummaryContext,
  parseSummaryResponse,
  requestPullRequestSummary,
  truncatePatchForSummary,
} from "../lib/ai-summary";

const samplePr = {
  owner: "owner",
  repo: "repo",
  number: 7,
  title: "Add GitHub PR fetching",
  author: "octocat",
  body: "Fetch GitHub PR files for review.",
  additions: 120,
  deletions: 30,
  changedFiles: 2,
};

const sampleFiles = [
  {
    filename: "app/page.js",
    status: "modified",
    additions: 80,
    deletions: 20,
    changes: 100,
    patch: "@@ -1 +1 @@\n+console.log('changed')",
  },
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("truncatePatchForSummary", () => {
  test("keeps short patches unchanged", () => {
    expect(truncatePatchForSummary("short patch", 50)).toBe("short patch");
  });

  test("marks long patches as truncated", () => {
    const result = truncatePatchForSummary("a".repeat(20), 8);

    expect(result).toContain("aaaaaaaa");
    expect(result).toContain("patch 已截断");
  });
});

describe("buildSummaryContext", () => {
  test("includes PR metadata and changed file context", () => {
    const context = buildSummaryContext(samplePr, sampleFiles, {
      maxFiles: 5,
      maxPatchLength: 200,
    });

    expect(context).toContain("Add GitHub PR fetching");
    expect(context).toContain("Fetch GitHub PR files for review.");
    expect(context).toContain("+120 / -30");
    expect(context).toContain("app/page.js");
    expect(context).toContain("@@ -1 +1 @@");
  });

  test("limits the number of files in the model context", () => {
    const context = buildSummaryContext(
      samplePr,
      [
        ...sampleFiles,
        { ...sampleFiles[0], filename: "lib/github.js" },
        { ...sampleFiles[0], filename: "README.md" },
      ],
      { maxFiles: 2, maxPatchLength: 200 },
    );

    expect(context).toContain("app/page.js");
    expect(context).toContain("lib/github.js");
    expect(context).not.toContain("README.md");
    expect(context).toContain("其余 1 个文件未放入模型上下文");
  });
});

describe("parseSummaryResponse", () => {
  test("parses plain JSON summary", () => {
    const summary = parseSummaryResponse(
      JSON.stringify({
        overview: "Adds PR fetching.",
        businessChanges: ["Users can fetch PR data."],
        technicalChanges: ["Adds API route."],
        testChanges: ["Adds tests."],
        impactScope: ["Review workflow."],
        reviewFocus: ["API errors."],
      }),
    );

    expect(summary.overview).toBe("Adds PR fetching.");
    expect(summary.reviewFocus).toEqual(["API errors."]);
  });

  test("parses JSON wrapped in a markdown code block", () => {
    const summary = parseSummaryResponse(`\`\`\`json
{"overview":"ok","businessChanges":[],"technicalChanges":[],"testChanges":[],"impactScope":[],"reviewFocus":[]}
\`\`\``);

    expect(summary.overview).toBe("ok");
  });

  test("throws a typed error for invalid JSON", () => {
    expect(() => parseSummaryResponse("not json")).toThrow(AiSummaryError);
  });
});

describe("requestPullRequestSummary", () => {
  test("requires a local DeepSeek API key", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");

    await expect(requestPullRequestSummary(samplePr, sampleFiles)).rejects.toMatchObject({
      code: "DEEPSEEK_CONFIG_MISSING",
    });
  });

  test("uses deterministic temperature when calling DeepSeek", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          choices: [
            {
              message: {
                content:
                  '{"overview":"ok","businessChanges":[],"technicalChanges":[],"testChanges":[],"impactScope":[],"reviewFocus":[]}',
              },
            },
          ],
        };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestPullRequestSummary(samplePr, sampleFiles);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).temperature).toBe(0);
  });
});
