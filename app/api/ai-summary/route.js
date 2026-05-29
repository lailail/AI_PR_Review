import { NextResponse } from "next/server";
import { AiSummaryError, requestPullRequestSummary } from "@/lib/ai-summary";

function isValidSummaryInput(pr, files) {
  return pr && typeof pr === "object" && Array.isArray(files);
}

/**
 * 生成 Pull Request 变更总结。
 * 前端不能直接调用 DeepSeek API，因此这里由服务端读取本地环境变量并统一处理模型错误。
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { pr, files } = body || {};

    if (!isValidSummaryInput(pr, files)) {
      throw new AiSummaryError("INVALID_SUMMARY_INPUT", "缺少可用于生成总结的 Pull Request 数据。", 400);
    }

    const summary = await requestPullRequestSummary(pr, files);

    return NextResponse.json({ summary });
  } catch (error) {
    if (error instanceof AiSummaryError) {
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
          message: "生成 PR 变更总结时发生未知错误。",
        },
      },
      { status: 500 },
    );
  }
}
