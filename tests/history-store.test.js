import { describe, expect, test } from "vitest";
import {
  buildHistoryRecord,
  buildPatchDigest,
  findHistoryByRepository,
  getRepositoryKey,
  groupHistoryByRepository,
  upsertHistoryRecord,
} from "../lib/history-store";

const pr = {
  owner: "lailail",
  repo: "AI_PR_Review",
  number: 3,
  title: "添加 Review 建议",
  author: "lailail",
  htmlUrl: "https://github.com/lailail/AI_PR_Review/pull/3",
  changedFiles: 2,
  additions: 120,
  deletions: 12,
};

const files = [
  {
    filename: "app/page.js",
    status: "modified",
    changes: 100,
    patch: "page patch".repeat(100),
  },
  {
    filename: "README.md",
    status: "modified",
    changes: 20,
    patch: "readme patch",
  },
];

describe("history-store", () => {
  test("generates repository key from PR owner and repo", () => {
    expect(getRepositoryKey(pr)).toBe("lailail/AI_PR_Review");
  });

  test("builds patch digest by prioritizing risky and large-change files", () => {
    const digest = buildPatchDigest(
      files,
      [{ file: "README.md" }],
      { maxFiles: 2, maxExcerptLength: 12 },
    );

    expect(digest).toEqual([
      {
        filename: "README.md",
        status: "modified",
        changes: 20,
        excerpt: "readme patch",
      },
      {
        filename: "app/page.js",
        status: "modified",
        changes: 100,
        excerpt: "page patchpa",
      },
    ]);
  });

  test("builds a compact history record without full patch content", () => {
    const summary = { overview: "本次 PR 增加 Review 建议能力" };
    const risks = [{ file: "app/page.js", severity: "medium" }];
    const suggestions = [{ file: "app/page.js", problem: "缺少错误提示" }];

    const record = buildHistoryRecord(pr, files, summary, risks, suggestions, {
      now: "2026-05-30T10:00:00.000Z",
      maxExcerptLength: 10,
    });

    expect(record).toMatchObject({
      repositoryKey: "lailail/AI_PR_Review",
      prNumber: 3,
      prUrl: "https://github.com/lailail/AI_PR_Review/pull/3",
      title: "添加 Review 建议",
      author: "lailail",
      analyzedAt: "2026-05-30T10:00:00.000Z",
      changedFiles: 2,
      additions: 120,
      deletions: 12,
      summary,
      risks,
      suggestions,
    });
    expect(record.patchDigest[0].excerpt.length).toBeLessThanOrEqual(10);
    expect(record.patchDigest[0]).not.toHaveProperty("patch");
  });

  test("overwrites old history when repository and PR number are the same", () => {
    const oldRecord = {
      repositoryKey: "lailail/AI_PR_Review",
      prNumber: 3,
      title: "旧记录",
      analyzedAt: "2026-05-29T10:00:00.000Z",
    };
    const newRecord = {
      repositoryKey: "lailail/AI_PR_Review",
      prNumber: 3,
      title: "新记录",
      analyzedAt: "2026-05-30T10:00:00.000Z",
    };

    expect(upsertHistoryRecord([oldRecord], newRecord)).toEqual([newRecord]);
  });

  test("keeps newest records within the configured max count", () => {
    const existingRecords = Array.from({ length: 60 }, (_, index) => ({
      repositoryKey: "owner/repo",
      prNumber: index + 1,
      analyzedAt: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const newRecord = {
      repositoryKey: "owner/repo",
      prNumber: 100,
      analyzedAt: "2026-05-30T10:00:00.000Z",
    };

    const result = upsertHistoryRecord(existingRecords, newRecord, { maxRecords: 50 });

    expect(result).toHaveLength(50);
    expect(result[0]).toBe(newRecord);
    expect(result.at(-1).prNumber).toBe(49);
  });

  test("groups and filters history by repository", () => {
    const records = [
      { repositoryKey: "owner/repo-a", prNumber: 1 },
      { repositoryKey: "owner/repo-b", prNumber: 2 },
      { repositoryKey: "owner/repo-a", prNumber: 3 },
    ];

    expect(groupHistoryByRepository(records)).toEqual({
      "owner/repo-a": [
        { repositoryKey: "owner/repo-a", prNumber: 1 },
        { repositoryKey: "owner/repo-a", prNumber: 3 },
      ],
      "owner/repo-b": [{ repositoryKey: "owner/repo-b", prNumber: 2 }],
    });
    expect(findHistoryByRepository(records, "owner/repo-a")).toEqual([
      { repositoryKey: "owner/repo-a", prNumber: 1 },
      { repositoryKey: "owner/repo-a", prNumber: 3 },
    ]);
  });
});
