import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessSidecar } from "./harness-sidecar.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("HarnessSidecar", () => {
  it("publishes readiness and stops a supervised child without scheduling recovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-sidecar-test-"));
    temporaryDirectories.push(root);
    const cliDirectory = join(root, "app", "node_modules", "@deepseek-ai", "dsh", "lib");
    await mkdir(cliDirectory, { recursive: true });
    await writeFile(join(cliDirectory, "bin.js"), "console.log('dsh web: http://127.0.0.1:43210'); setInterval(() => {}, 1000);\n");
    const sidecar = new HarnessSidecar({
      appPath: join(root, "app"),
      userDataPath: join(root, "data"),
      workspacePath: root,
      executablePath: process.execPath,
    });
    const ready = new Promise<void>((resolve) => sidecar.on("change", (snapshot) => { if (snapshot.phase === "ready") resolve(); }));
    await sidecar.start();
    await ready;
    expect(sidecar.snapshot.url).toBe("http://127.0.0.1:43210");
    await sidecar.stop();
    expect(sidecar.snapshot.phase).toBe("stopped");
    expect(sidecar.snapshot.restartAttempt).toBeUndefined();
  });
});
