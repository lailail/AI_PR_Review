import { NextResponse } from "next/server";
import { fetchDeepSeekModels, ModelConfigError } from "@/lib/model-config";

/**
 * 根据用户输入的 DeepSeek API Key 获取该账号可用模型。
 * API Key 只用于服务端请求 DeepSeek，不会写入 .env.local，也不会返回给前端。
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const models = await fetchDeepSeekModels(body?.deepSeekApiKey);

    return NextResponse.json({ models });
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
          code: "MODEL_CONFIG_MODEL_LIST_ERROR",
          message: "获取 DeepSeek 模型列表失败。",
        },
      },
      { status: 500 },
    );
  }
}
