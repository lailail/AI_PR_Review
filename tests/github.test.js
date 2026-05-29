import { describe, expect, test } from "vitest";
import {
  formatPullRequestFiles,
  formatPullRequestInfo,
  parseGitHubPullRequestUrl,
} from "../lib/github";

describe("parseGitHubPullRequestUrl", () => {
  test("parses a standard GitHub pull request URL", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/owner/repo/pull/123")).toEqual({
      owner: "owner",
      repo: "repo",
      pullNumber: 123,
    });
  });

  test("parses a pull request URL with query string", () => {
    expect(
      parseGitHubPullRequestUrl("https://github.com/owner/repo/pull/456/files?diff=split"),
    ).toEqual({
      owner: "owner",
      repo: "repo",
      pullNumber: 456,
    });
  });

  test("throws a typed error for invalid URLs", () => {
    expect(() => parseGitHubPullRequestUrl("https://example.com/owner/repo/pull/1")).toThrow(
      "INVALID_PR_URL",
    );
  });
});

describe("formatPullRequestInfo", () => {
  test("keeps only the fields needed by the UI and later AI analysis", () => {
    const result = formatPullRequestInfo({
      number: 12,
      title: "Improve parser",
      user: { login: "octocat" },
      state: "open",
      html_url: "https://github.com/owner/repo/pull/12",
      created_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-02T00:00:00Z",
      body: "Parser changes",
      additions: 20,
      deletions: 5,
      changed_files: 2,
      unused: "not returned",
    });

    expect(result).toEqual({
      number: 12,
      title: "Improve parser",
      author: "octocat",
      state: "open",
      htmlUrl: "https://github.com/owner/repo/pull/12",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      body: "Parser changes",
      additions: 20,
      deletions: 5,
      changedFiles: 2,
    });
  });
});

describe("formatPullRequestFiles", () => {
  test("normalizes changed file records", () => {
    expect(
      formatPullRequestFiles([
        {
          filename: "app/page.js",
          status: "modified",
          additions: 10,
          deletions: 3,
          changes: 13,
          patch: "@@ -1 +1 @@",
          raw_url: "ignored",
        },
      ]),
    ).toEqual([
      {
        filename: "app/page.js",
        status: "modified",
        additions: 10,
        deletions: 3,
        changes: 13,
        patch: "@@ -1 +1 @@",
      },
    ]);
  });
});
