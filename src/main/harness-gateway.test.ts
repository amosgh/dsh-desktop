import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessGateway } from "./harness-gateway.js";

const gateways: HarnessGateway[] = [];

afterEach(async () => {
  await Promise.all(gateways.splice(0).map((gateway) => gateway.stop()));
});

describe("HarnessGateway", () => {
  it("fails closed and proxies only authenticated requests", async () => {
    const upstream = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ path: request.url, host: request.headers.host }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as AddressInfo;
    const gateway = new HarnessGateway();
    gateways.push(gateway);

    try {
      const session = await gateway.start(`http://127.0.0.1:${upstreamAddress.port}`);

      const unauthorized = await fetch(`${session.endpoint}/workspace`);
      expect(unauthorized.status).toBe(401);

      const health = await fetch(`${session.endpoint}/_dsh_desktop/health`, {
        headers: { "x-dsh-desktop-token": session.token },
      });
      expect(await health.json()).toEqual({ protocolVersion: "1", authenticated: true });

      const proxied = await fetch(`${session.endpoint}/workspace?task=1`, {
        headers: { cookie: `${session.cookieName}=${session.token}` },
      });
      expect(proxied.status).toBe(200);
      expect(await proxied.json()).toEqual({
        path: "/workspace?task=1",
        host: `127.0.0.1:${upstreamAddress.port}`,
      });
      expect(proxied.headers.get("cache-control")).toBe("no-store");
    } finally {
      await gateway.stop();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  it("rejects non-loopback upstreams", async () => {
    const gateway = new HarnessGateway();
    gateways.push(gateway);
    await expect(gateway.start("https://example.com")).rejects.toThrow("non-loopback");
  });
});
