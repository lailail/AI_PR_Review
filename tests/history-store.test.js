import { describe, expect, test } from "vitest";
import {
  buildChangedFileSnapshots,
  buildHistoryRecord,
  buildPatchDigest,
  findHistoryByRepository,
  getRepositoryKey,
  groupHistoryByRepository,
  normalizeHistoryRecords,
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

  test("builds changed file snapshots for full change display", () => {
    const snapshots = buildChangedFileSnapshots(
      [
        {
          filename: "app/page.js",
          status: "modified",
          additions: 9,
          deletions: 2,
          changes: 11,
          patch: "0123456789abcdef",
        },
        {
          filename: "public/logo.png",
          status: "modified",
          additions: 0,
          deletions: 0,
          changes: 1,
        },
      ],
      { maxPatchLength: 10 },
    );

    expect(snapshots).toEqual([
      {
        filename: "app/page.js",
        status: "modified",
        additions: 9,
        deletions: 2,
        changes: 11,
        patch: "0123456789",
        isPatchTruncated: true,
        hasPatch: true,
      },
      {
        filename: "public/logo.png",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 1,
        patch: "",
        isPatchTruncated: false,
        hasPatch: false,
      },
    ]);
  });

  test("stores changed file snapshots in history record for later display", () => {
    const record = buildHistoryRecord(pr, files, null, [], [], {
      now: "2026-05-30T10:00:00.000Z",
      maxChangedFilePatchLength: 12,
    });

    expect(record.changedFileSnapshots).toEqual([
      {
        filename: "app/page.js",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 100,
        patch: "page patchpa",
        isPatchTruncated: true,
        hasPatch: true,
      },
      {
        filename: "README.md",
        status: "modified",
        additions: 0,
        deletions: 0,
        changes: 20,
        patch: "readme patch",
        isPatchTruncated: false,
        hasPatch: true,
      },
    ]);
  });

  test("stores rule signals with history record for risk display", () => {
    const ruleSignals = [
      {
        file: "app/api/auth/route.js",
        labels: ["权限/鉴权", "接口输入"],
        reason: "命中权限和接口关键词",
      },
    ];
    const record = buildHistoryRecord(pr, files, null, [], [], {
      now: "2026-05-30T10:00:00.000Z",
      ruleSignals,
    });

    expect(record.ruleSignals).toEqual(ruleSignals);
  });

  test("handles empty files and missing patch when building patch digest", () => {
    expect(buildPatchDigest()).toEqual([]);

    expect(
      buildPatchDigest([
        {
          filename: "public/logo.png",
          status: "modified",
          changes: 1,
        },
      ]),
    ).toEqual([
      {
        filename: "public/logo.png",
        status: "modified",
        changes: 1,
        excerpt: "",
      },
    ]);
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

  test("normalizes persisted history and removes invalid records", () => {
    const validRecord = {
      repositoryKey: "owner/repo-a",
      prNumber: 1,
      title: "有效记录",
      analyzedAt: "2026-05-30T10:00:00.000Z",
      patchDigest: [{ filename: "app/page.js", excerpt: "@@ -1 +1 @@" }],
      ruleSignals: [
        {
          file: "app/api/auth/route.js",
          labels: ["权限/鉴权"],
          reason: "命中权限关键词",
        },
      ],
      changedFileSnapshots: [
        {
          filename: "app/page.js",
          status: "modified",
          additions: 3,
          deletions: 1,
          changes: 4,
          patch: "@@ -1 +1 @@",
          isPatchTruncated: false,
          hasPatch: true,
        },
      ],
    };

    expect(
      normalizeHistoryRecords([
        validRecord,
        null,
        { repositoryKey: "", prNumber: 2 },
        { repositoryKey: "owner/repo-b", prNumber: "bad" },
        { repositoryKey: "owner/repo-c", prNumber: 3, patchDigest: "bad" },
      ]),
    ).toEqual([
      {
        ...validRecord,
        author: "unknown",
        additions: 0,
        changedFiles: 0,
        deletions: 0,
        prUrl: "",
        risks: [],
        ruleSignals: [
          {
            file: "app/api/auth/route.js",
            labels: ["权限/鉴权"],
            reason: "命中权限关键词",
          },
        ],
        suggestions: [],
        summary: null,
      },
    ]);

    expect(normalizeHistoryRecords({ repositoryKey: "owner/repo" })).toEqual([]);
  });

  test("normalizes old history records without full change snapshots", () => {
    const [record] = normalizeHistoryRecords([
      {
        repositoryKey: "owner/repo-a",
        prNumber: 1,
        patchDigest: [{ filename: "app/page.js", excerpt: "@@ -1 +1 @@" }],
      },
    ]);

    expect(record.changedFileSnapshots).toEqual([]);
  });
});
