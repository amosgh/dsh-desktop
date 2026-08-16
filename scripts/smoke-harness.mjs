import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const harnessHome = await mkdtemp(join(tmpdir(), "dsh-desktop-smoke-"));
const cliPath = new URL("../node_modules/@deepseek-ai/dsh/lib/bin.js", import.meta.url);
const child = spawn(
  process.execPath,
  [cliPath.pathname, "web", "--host", "127.0.0.1", "--port", "0"],
  {
    cwd: process.cwd(),
    env: { ...process.env, DSH_HOME: harnessHome },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
let settled = false;

async function cleanup() {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await rm(harnessHome, { recursive: true, force: true });
}

const timeout = setTimeout(async () => {
  if (settled) return;
  settled = true;
  await cleanup();
  console.error(`Harness smoke test timed out.\n${output}`);
  process.exitCode = 1;
}, 30_000);

child.stderr.setEncoding("utf8");
child.stdout.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  output += chunk;
});
child.stdout.on("data", async (chunk) => {
  output += chunk;
  const match = /^dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)\s*$/m.exec(output);
  if (!match?.[1] || settled) return;
  settled = true;
  clearTimeout(timeout);
  try {
    const response = await fetch(match[1]);
    const html = await response.text();
    if (!response.ok || !html.includes("window.__DSH_BOOT__")) {
      throw new Error(`Unexpected Harness response: HTTP ${response.status}`);
    }
    console.log(`Harness smoke test passed at ${match[1]}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
});
child.once("exit", (code, signal) => {
  if (!settled) {
    settled = true;
    clearTimeout(timeout);
    console.error(`Harness exited before readiness (${signal ?? `code ${code}`}).\n${output}`);
    process.exitCode = 1;
    void cleanup();
  }
});
