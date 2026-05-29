import { NextResponse } from "next/server";
import { requestReviewSuggestions, ReviewSuggestionError } from "@/lib/review-suggestions";

function isValidReviewInput(pr, files) {
  return pr && typeof pr === "object" && Array.isArray(files);
}

/**
 * 生成 Pull Request Review 建议。
 * 该接口只负责服务端分析并返回建议，不会自动评论到 GitHub，避免误把 AI 输出直接发布。
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { pr, files, summary, risks } = body || {};

    if (!isValidReviewInput(pr, files)) {
      throw new ReviewSuggestionError("INVALID_REVIEW_INPUT", "缺少可用于生成 Review 建议的 Pull Request 数据。", 400);
    }

    const result = await requestReviewSuggestions(pr, files, summary || {}, Array.isArray(risks) ? risks : []);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReviewSuggestionError) {
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
          message: "生成 Review 建议时发生未知错误。",
        },
      },
      { status: 500 },
    );
  }
}
