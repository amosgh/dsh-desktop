import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";

const COOKIE_NAME = "dsh_desktop_session";
const PROTOCOL_VERSION = "1" as const;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface GatewaySession {
  endpoint: string;
  cookieName: string;
  token: string;
  protocolVersion: typeof PROTOCOL_VERSION;
}

export class HarnessGateway {
  #server: Server | undefined;
  #upstream: URL | undefined;
  #session: GatewaySession | undefined;
  #sockets = new Set<Duplex>();

  get session(): GatewaySession | undefined {
    return this.#session ? { ...this.#session } : undefined;
  }

  async start(upstreamOrigin: string): Promise<GatewaySession> {
    await this.stop();
    const upstream = new URL(upstreamOrigin);
    if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1") {
      throw new Error("Gateway refused a non-loopback Harness endpoint.");
    }

    this.#upstream = upstream;
    const token = randomBytes(32).toString("hex");
    const server = createServer((request, response) => this.#handleRequest(request, response));
    server.on("upgrade", (request, socket, head) => this.#handleUpgrade(request, socket, head));
    server.on("connection", (socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
    });
    this.#server = server;

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });

    const address = server.address() as AddressInfo;
    this.#session = {
      endpoint: `http://127.0.0.1:${address.port}`,
      cookieName: COOKIE_NAME,
      token,
      protocolVersion: PROTOCOL_VERSION,
    };
    await this.verify();
    return { ...this.#session };
  }

  async verify(): Promise<void> {
    const session = this.#session;
    if (!session) throw new Error("Gateway is not running.");
    const response = await fetch(`${session.endpoint}/_dsh_desktop/health`, {
      headers: { "x-dsh-desktop-token": session.token },
    });
    if (!response.ok) throw new Error(`Gateway handshake failed with HTTP ${response.status}.`);
    const body = (await response.json()) as { protocolVersion?: unknown; authenticated?: unknown };
    if (body.protocolVersion !== PROTOCOL_VERSION || body.authenticated !== true) {
      throw new Error("Gateway protocol version mismatch.");
    }
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#session = undefined;
    this.#upstream = undefined;
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  #authorized(request: IncomingMessage): boolean {
    const token = this.#session?.token;
    if (!token) return false;
    const headerToken = request.headers["x-dsh-desktop-token"];
    const cookieToken = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([name]) => name === COOKIE_NAME)?.[1];
    const supplied = typeof headerToken === "string" ? headerToken : cookieToken;
    if (!supplied) return false;
    const expectedBuffer = Buffer.from(token);
    const suppliedBuffer = Buffer.from(supplied);
    return suppliedBuffer.length === expectedBuffer.length
      && timingSafeEqual(suppliedBuffer, expectedBuffer);
  }

  #handleRequest(request: IncomingMessage, response: ServerResponse): void {
    if (!this.#authorized(request)) {
      response.writeHead(401, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Unauthorized");
      return;
    }
    if (request.url === "/_dsh_desktop/health") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify({ protocolVersion: PROTOCOL_VERSION, authenticated: true }));
      return;
    }

    const upstream = this.#upstream;
    if (!upstream) {
      response.writeHead(503).end();
      return;
    }
    const proxyRequest = requestHttp({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers: this.#upstreamHeaders(request.headers, upstream),
    }, (proxyResponse) => {
      const headers = this.#responseHeaders(proxyResponse.headers);
      response.writeHead(proxyResponse.statusCode ?? 502, headers);
      proxyResponse.pipe(response);
    });
    proxyRequest.once("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("Harness upstream unavailable");
    });
    request.pipe(proxyRequest);
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.#authorized(request) || !this.#upstream) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = this.#upstream;
    const proxyRequest = requestHttp({
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: request.method,
      path: request.url,
      headers: { ...this.#upstreamHeaders(request.headers, upstream), connection: "Upgrade", upgrade: request.headers.upgrade ?? "websocket" },
    });
    proxyRequest.on("upgrade", (proxyResponse, proxySocket, proxyHead) => {
      socket.write(`HTTP/1.1 ${proxyResponse.statusCode ?? 101} ${proxyResponse.statusMessage ?? "Switching Protocols"}\r\n`);
      for (const [name, value] of Object.entries(proxyResponse.headers)) {
        if (value !== undefined) socket.write(`${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`);
      }
      socket.write("\r\n");
      if (head.length > 0) proxySocket.write(head);
      if (proxyHead.length > 0) socket.write(proxyHead);
      proxySocket.pipe(socket).pipe(proxySocket);
    });
    proxyRequest.once("error", () => socket.destroy());
    proxyRequest.end();
  }

  #upstreamHeaders(headers: IncomingHttpHeaders, upstream: URL): IncomingHttpHeaders {
    const next: IncomingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name) && name !== "cookie" && name !== "x-dsh-desktop-token") {
        next[name] = value;
      }
    }
    next.host = upstream.host;
    if (headers.origin) next.origin = upstream.origin;
    return next;
  }

  #responseHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
    const next: IncomingHttpHeaders = {};
    for (const [name, value] of Object.entries(headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name) && name !== "set-cookie") next[name] = value;
    }
    next["cache-control"] = "no-store";
    return next;
  }
}
