import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessProtocolClient } from "./harness-protocol-client.js";

class FakeWebSocket extends EventTarget {
  static readonly OPEN = 1;
  readyState = FakeWebSocket.OPEN;

  constructor(_url: URL) {
    super();
    queueMicrotask(() => this.dispatchEvent(new Event("open")));
  }

  close(): void {
    this.readyState = 3;
  }
}

afterEach(() => vi.unstubAllGlobals());

describe("HarnessProtocolClient", () => {
  it("restores persisted workspace metadata and archives a partially-created task on failure", async () => {
    const existingSession = "11111111-1111-4111-8111-111111111111";
    const newSession = "22222222-2222-4222-8222-222222222222";
    const methods: string[] = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { rpcId: string; method: string };
      methods.push(request.method);
      const value = request.method === "session.list"
        ? { items: [{ sessionId: existingSession, updatedAt: 1, running: false, blank: false, cwd: "/managed/worktree" }] }
        : request.method === "workspace.list"
          ? { archivedSessionIds: [] }
          : {};
      const result = request.method === "session.selectModel"
        ? { ok: false, error: { code: "model-unavailable", message: "model unavailable", details: null } }
        : { ok: true, value };
      return new Response(JSON.stringify({ type: "server-response", rpcId: request.rpcId, result }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const client = new HarnessProtocolClient();
    client.registerTaskWorkspace(existingSession, "/repository", "dsh/existing", "discarded");
    const connected = new Promise<void>((resolve) => client.on("change", (snapshot) => { if (snapshot.phase === "connected") resolve(); }));
    client.connect("http://127.0.0.1:43210");
    await connected;
    expect(client.snapshot.tasks[0]).toMatchObject({ projectPath: "/repository", workspaceState: "discarded" });

    client.registerTaskWorkspace(newSession, "/repository", "dsh/new", "active");
    await expect(client.createTask("/managed/new", "do work", newSession)).rejects.toThrow("model unavailable");
    expect(methods).toContain("workspace.archiveSession");
    client.disconnect(true);
  });
});
