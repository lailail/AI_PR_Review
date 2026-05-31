import { describe, expect, test } from "vitest";
import {
  buildHistoryComparisonContext,
  buildHistoryComparisonMessages,
  HistoryComparisonError,
  parseHistoryComparisonResponse,
  requestHistoryComparison,
  selectHistoryForComparison,
} from "../lib/history-comparison";

const currentPr = {
  owner: "lailail",
  repo: "AI_PR_Review",
  number: 10,
  title: "添加历史对比分析",
  author: "lailail",
  additions: 120,
  deletions: 20,
  changedFiles: 4,
};

function createHistoryRecord(prNumber, repositoryKey = "lailail/AI_PR_Review", analyzedAt = "2026-05-30T10:00:00.000Z") {
  return {
    repositoryKey,
    prNumber,
    prUrl: `https://github.com/${repositoryKey}/pull/${prNumber}`,
    title: `历史 PR ${prNumber}`,
    analyzedAt,
    summary: { overview: `历史 PR ${prNumber} 摘要` },
    risks: [{ file: "app/page.js", severity: "medium", reason: "历史风险" }],
    suggestions: [{ file: "app/page.js", problem: "历史问题", suggestion: "历史建议", confidence: 0.7 }],
    patchDigest: [{ filename: "app/page.js", excerpt: "@@ -1 +1 @@", patch: "不应该进入上下文" }],
  };
}

describe("history-comparison", () => {
  test("selects only same-repository history and excludes current PR", () => {
    const selected = selectHistoryForComparison(currentPr, [
      createHistoryRecord(1),
      createHistoryRecord(10),
      createHistoryRecord(2, "octocat/Hello-World"),
    ]);

    expect(selected.map((record) => record.prNumber)).toEqual([1]);
  });

  test("keeps latest history records within max count", () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      createHistoryRecord(index + 1, "lailail/AI_PR_Review", `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    );

    const selected = selectHistoryForComparison(currentPr, records, { maxHistory: 5 });

    expect(selected).toHaveLength(5);
    expect(selected.map((record) => record.prNumber)).toEqual([12, 11, 9, 8, 7]);
  });

  test("builds comparison context without full diff patch", () => {
    const context = buildHistoryComparisonContext(
      {
        pr: currentPr,
        summary: { overview: "当前 PR 摘要" },
        risks: [],
        suggestions: [],
      },
      [createHistoryRecord(1)],
    );

    expect(context.repository).toBe("lailail/AI_PR_Review");
    expect(context.history).toHaveLength(1);
    expect(JSON.stringify(context)).toContain("历史 PR 1 摘要");
    expect(JSON.stringify(context)).not.toContain("不应该进入上下文");
  });

  test("builds messages that require JSON output", () => {
    const context = buildHistoryComparisonContext({ pr: currentPr }, [createHistoryRecord(1)]);
    const messages = buildHistoryComparisonMessages(context);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[1].content).toContain("请输出 JSON 对象");
  });

  test("parses JSON wrapped in markdown fences", () => {
    const comparison = parseHistoryComparisonResponse(
      '```json\n{"comparedPrs":[{"number":1,"title":"历史 PR 1","relation":"复用了历史能力"}],"impactAnalysis":["可能影响历史记录展示"],"repeatedRisks":["重复出现 localStorage 兼容风险"],"reviewFocus":["确认旧缓存兼容"],"contextNotes":["使用 1 条历史记录"],"confidence":0.82}\n```',
      { repository: "lailail/AI_PR_Review", mode: "compare-with-history", currentPr: { number: 10, title: "当前 PR" } },
    );

    expect(comparison).toEqual({
      repository: "lailail/AI_PR_Review",
      mode: "compare-with-history",
      currentPr: { number: 10, title: "当前 PR" },
      comparedPrs: [{ number: 1, title: "历史 PR 1", relation: "复用了历史能力" }],
      impactAnalysis: ["可能影响历史记录展示"],
      repeatedRisks: ["重复出现 localStorage 兼容风险"],
      reviewFocus: ["确认旧缓存兼容"],
      contextNotes: ["使用 1 条历史记录"],
      confidence: 0.82,
    });
  });

  test("throws a typed error when API key is missing", async () => {
    await expect(
      requestHistoryComparison(
        {
          current: { pr: currentPr },
          history: [createHistoryRecord(1)],
        },
        { apiKey: "" },
      ),
    ).rejects.toMatchObject({
      code: "HISTORY_COMPARISON_CONFIG_ERROR",
      status: 400,
    });
  });

  test("requests model with context API key and parses response", async () => {
    const fetchCalls = [];
    const fetcher = async (url, options) => {
      fetchCalls.push({ url, options });

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              {
                message: {
                  content:
                    '{"comparedPrs":[{"number":1,"title":"历史 PR 1","relation":"相关"}],"impactAnalysis":["影响历史功能"],"repeatedRisks":[],"reviewFocus":["重点看历史记录兼容"],"contextNotes":[],"confidence":0.7}',
                },
              },
            ],
          };
        },
      };
    };

    const result = await requestHistoryComparison(
      {
        current: { pr: currentPr },
        history: [createHistoryRecord(1)],
      },
      {
        apiKey: "context-key",
        model: "deepseek-v4-pro",
        fetcher,
      },
    );

    expect(fetchCalls[0].options.headers.Authorization).toBe("Bearer context-key");
    expect(JSON.parse(fetchCalls[0].options.body).model).toBe("deepseek-v4-pro");
    expect(JSON.parse(fetchCalls[0].options.body).temperature).toBe(0);
    expect(result.comparison.impactAnalysis).toEqual(["影响历史功能"]);
  });

  test("throws when there is no related history", async () => {
    await expect(
      requestHistoryComparison(
        {
          current: { pr: currentPr },
          history: [createHistoryRecord(1, "octocat/Hello-World")],
        },
        { apiKey: "key", fetcher: async () => ({}) },
      ),
    ).rejects.toBeInstanceOf(HistoryComparisonError);
  });
});
