import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessProtocolClient } from "../dist/main/harness-protocol-client.js";

const harnessHome = await mkdtemp(join(tmpdir(), "dsh-protocol-smoke-"));
const cliPath = join(process.cwd(), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const child = spawn(process.execPath, [cliPath, "web", "--host", "127.0.0.1", "--port", "0"], {
  cwd: process.cwd(),
  env: { ...process.env, DSH_HOME: harnessHome },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");

let output = "";
const endpoint = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Harness startup timed out.\n${output}`)), 25_000);
  const consume = (chunk) => {
    output += chunk;
    const match = /^dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(output);
    if (!match?.[1]) return;
    clearTimeout(timeout);
    resolve(match[1]);
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.once("exit", (code) => reject(new Error(`Harness exited with ${code}.\n${output}`)));
});

const protocol = new HarnessProtocolClient();
try {
  const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Protocol connection timed out.")), 15_000);
    protocol.on("change", (snapshot) => {
      if (snapshot.phase === "connected") {
        clearTimeout(timeout);
        resolve(snapshot);
      }
    });
  });
  protocol.connect(endpoint);
  const snapshot = await connected;
  const refreshed = await protocol.refresh();
  if (refreshed.phase !== "connected" || !Array.isArray(refreshed.tasks)) {
    throw new Error("Protocol baseline was invalid.");
  }
  const sessionId = randomUUID();
  const rpcId = randomUUID();
  const created = await fetch(new URL("/api/session.create", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId, method: "session.create", payload: { sessionId, cwd: process.cwd() } }),
  }).then((response) => response.json());
  if (created?.result?.ok !== true) throw new Error("Could not create an empty history smoke session.");
  const modelRpcId = randomUUID();
  const selected = await fetch(new URL("/api/session.selectModel", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "client-request", rpcId: modelRpcId, method: "session.selectModel", payload: { sessionId, provider: "deepseek-official", model: "deepseek-v4-flash" } }),
  }).then((response) => response.json());
  if (selected?.result?.ok !== true || selected.result.value?.selected?.model !== "deepseek-v4-flash") {
    throw new Error(`Could not select the session model: ${JSON.stringify(selected)}`);
  }
  const timeline = await protocol.loadTimeline(sessionId);
  if (timeline.phase !== "ready" || timeline.items.length !== 0 || timeline.hasMore) {
    throw new Error("Protocol history baseline was invalid.");
  }
  console.log(`Harness protocol smoke passed at ${endpoint}; generation ${snapshot.generation}; history ready.`);
} finally {
  protocol.disconnect(true);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(harnessHome, { recursive: true, force: true });
}
