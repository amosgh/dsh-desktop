const MODEL_TEST_TIMEOUT_MS = 15_000;

function modelCatalogURL(baseURL: string): URL {
  const url = new URL(baseURL);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/models`.replace(/\/{2,}/g, "/");
  url.search = "";
  url.hash = "";
  return url;
}

export async function testModelConnection(baseURL: string, apiKey: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetch(modelCatalogURL(baseURL), {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_TEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("连接超时，请检查 API 端点或网络。", { cause: error });
    }
    throw new Error("无法连接模型服务，请检查 API 端点和网络。", { cause: error });
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("API Key 无效或没有访问该模型服务的权限。");
  }
  if (response.status === 404) {
    throw new Error("API 端点不支持模型列表，请检查端点地址是否正确。");
  }
  if (response.status === 429) {
    throw new Error("模型服务请求过于频繁，请稍后重试。");
  }
  if (!response.ok) {
    throw new Error(`模型服务连接失败（HTTP ${response.status}）。`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("模型服务返回了无法解析的响应。", { cause: error });
  }
  if (!payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray(payload.data)) {
    throw new Error("模型服务返回的模型列表格式不受支持。");
  }

  return payload.data.flatMap((model) => {
    if (!model || typeof model !== "object" || !("id" in model) || typeof model.id !== "string") return [];
    const id = model.id.trim();
    return id ? [id] : [];
  });
}
