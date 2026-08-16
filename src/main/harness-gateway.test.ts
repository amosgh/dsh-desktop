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

  it("intercepts authenticated Markdown open requests and preserves other paths", async () => {
    let upstreamCalls = 0;
    const upstream = createServer((_request, response) => {
      upstreamCalls += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "server-response", rpcId: "upstream", result: { ok: true, value: { opened: true } } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const gateway = new HarnessGateway();
    gateways.push(gateway);
    const opened: string[] = [];
    gateway.setMarkdownOpenHandler(async (path) => { opened.push(path); return true; });
    try {
      const address = upstream.address() as AddressInfo;
      const session = await gateway.start(`http://127.0.0.1:${address.port}`);
      const headers = { cookie: `${session.cookieName}=${session.token}`, "content-type": "application/json" };
      const markdown = await fetch(`${session.endpoint}/api/host.openPath`, { method: "POST", headers, body: JSON.stringify({ type: "client-request", rpcId: "md-1", method: "host.openPath", payload: { path: "/workspace/report.md" } }) });
      expect(await markdown.json()).toEqual({ type: "server-response", rpcId: "md-1", result: { ok: true, value: { opened: true } } });
      expect(opened).toEqual(["/workspace/report.md"]);
      expect(upstreamCalls).toBe(0);

      await fetch(`${session.endpoint}/api/host.openPath`, { method: "POST", headers, body: JSON.stringify({ type: "client-request", rpcId: "txt-1", method: "host.openPath", payload: { path: "/workspace/report.txt" } }) });
      expect(upstreamCalls).toBe(1);
    } finally {
      await gateway.stop();
      upstream.closeAllConnections();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });
});
