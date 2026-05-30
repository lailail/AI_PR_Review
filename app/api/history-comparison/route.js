import { NextResponse } from "next/server";
import { HistoryComparisonError, requestHistoryComparison } from "@/lib/history-comparison";

/**
 * 生成同仓库历史 PR 对比分析。
 * 前端只提交当前 PR 分析结果和本地历史摘要，DeepSeek API Key 与模型选择都留在服务端处理。
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!body?.current?.pr) {
      throw new HistoryComparisonError(
        "INVALID_COMPARISON_REQUEST",
        "缺少当前 PR 分析结果，无法生成历史对比。",
        400,
      );
    }

    if (!Array.isArray(body.history)) {
      throw new HistoryComparisonError(
        "INVALID_COMPARISON_REQUEST",
        "历史记录格式不正确，无法生成历史对比。",
        400,
      );
    }

    const result = await requestHistoryComparison({
      mode: body.mode || "compare-with-history",
      current: body.current,
      history: body.history,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HistoryComparisonError) {
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
          message: "生成历史 PR 对比分析时发生未知错误。",
        },
      },
      { status: 500 },
    );
  }
}
