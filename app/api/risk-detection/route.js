import { NextResponse } from "next/server";
import { requestRiskDetection, RiskDetectionError } from "@/lib/risk-detection";

function isValidRiskInput(pr, files) {
  return pr && typeof pr === "object" && Array.isArray(files);
}

/**
 * 识别 Pull Request 中的风险代码变更。
 * 前端不能直接调用 DeepSeek API，因此由服务端读取本地 API Key 并统一处理错误。
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { pr, files } = body || {};

    if (!isValidRiskInput(pr, files)) {
      throw new RiskDetectionError("INVALID_RISK_INPUT", "缺少可用于风险识别的 Pull Request 数据。", 400);
    }

    const result = await requestRiskDetection(pr, files);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RiskDetectionError) {
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
          message: "识别 PR 风险代码时发生未知错误。",
        },
      },
      { status: 500 },
    );
  }
}
