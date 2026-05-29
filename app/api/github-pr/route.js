import { NextResponse } from "next/server";
import {
  fetchPullRequestFiles,
  fetchPullRequestInfo,
  GitHubPrError,
  parseGitHubPullRequestUrl,
} from "@/lib/github";

/**
 * 获取 GitHub Pull Request 数据。
 * 前端只调用本项目后端接口，GitHub Token 和 GitHub API 细节都留在服务端处理。
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const prUrl = body?.prUrl;

    if (typeof prUrl !== "string" || !prUrl.trim()) {
      throw new GitHubPrError("INVALID_PR_URL", "请输入 GitHub Pull Request 链接。", 400);
    }

    const parsedPullRequest = parseGitHubPullRequestUrl(prUrl);

    /**
     * PR 基础信息和文件列表没有顺序依赖，使用并行请求可以降低用户等待时间。
     */
    const [pr, files] = await Promise.all([
      fetchPullRequestInfo(parsedPullRequest),
      fetchPullRequestFiles(parsedPullRequest),
    ]);

    return NextResponse.json({
      pr: {
        owner: parsedPullRequest.owner,
        repo: parsedPullRequest.repo,
        ...pr,
      },
      files,
    });
  } catch (error) {
    if (error instanceof GitHubPrError) {
      return NextResponse.json(
        {
          error: {
            code: error.code,
            message: error.clientMessage,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        error: {
          code: "UNKNOWN_ERROR",
          message: "获取 GitHub Pull Request 数据时发生未知错误。",
        },
      },
      { status: 500 },
    );
  }
}
