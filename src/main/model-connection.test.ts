import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { testModelConnection } from "./model-connection.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("testModelConnection", () => {
  it("validates credentials against the provider model endpoint", async () => {
    const endpoint = await listen(createServer((request, response) => {
      expect(request.url).toBe("/v1/models");
      expect(request.headers.authorization).toBe("Bearer test-key");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] }));
    }));

    await expect(testModelConnection(`${endpoint}/v1`, "test-key")).resolves.toEqual([
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
  });

  it("returns a useful credential error without exposing the provider body", async () => {
    const endpoint = await listen(createServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "provider-internal-detail" }));
    }));

    await expect(testModelConnection(endpoint, "bad-key")).rejects.toThrow(
      "API Key 无效或没有访问该模型服务的权限。",
    );
  });
});
