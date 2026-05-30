import { NextResponse } from "next/server";
import { ModelConfigError, readLocalModelConfig, updateLocalModelConfig } from "@/lib/model-config";

/**
 * 读取本地模型配置状态。
 * 这里只返回密钥是否已配置和脱敏预览，避免完整 API Key 暴露到浏览器。
 */
export async function GET() {
  try {
    return NextResponse.json({ config: readLocalModelConfig() });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "MODEL_CONFIG_READ_ERROR",
          message: "读取本地模型配置失败。",
        },
      },
      { status: 500 },
    );
  }
}

function isValidModelConfigInput(body) {
  return body && typeof body === "object";
}

/**
 * 保存本地 DeepSeek 配置。
 * 该接口会写入 .env.local，只适合本地演示环境；如果部署到公网，不应该开放给未授权用户。
 */
export async function POST(request) {
  try {
    const body = await request.json();

    if (!isValidModelConfigInput(body)) {
      throw new ModelConfigError("INVALID_MODEL_CONFIG_INPUT", "请输入有效的模型配置信息。", 400);
    }

    const config = updateLocalModelConfig(body);

    return NextResponse.json({ config });
  } catch (error) {
    if (error instanceof ModelConfigError) {
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
          code: "MODEL_CONFIG_SAVE_ERROR",
          message: "保存本地模型配置失败。",
        },
      },
      { status: 500 },
    );
  }
}
