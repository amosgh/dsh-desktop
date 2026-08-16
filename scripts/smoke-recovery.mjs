import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessSidecar } from "../dist/main/harness-sidecar.js";

const userDataPath = await mkdtemp(join(tmpdir(), "dsh-recovery-smoke-"));
const sidecar = new HarnessSidecar({
  appPath: process.cwd(),
  userDataPath,
  workspacePath: process.cwd(),
  executablePath: process.execPath,
});

function waitFor(predicate, label, timeoutMs = 25_000) {
  const initial = sidecar.snapshot;
  if (predicate(initial)) return Promise.resolve(initial);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      sidecar.off("change", onChange);
      reject(new Error(`Timed out waiting for ${label}; current phase ${sidecar.snapshot.phase}.`));
    }, timeoutMs);
    const onChange = (snapshot) => {
      if (!predicate(snapshot)) return;
      clearTimeout(timeout);
      sidecar.off("change", onChange);
      resolve(snapshot);
    };
    sidecar.on("change", onChange);
  });
}

try {
  await sidecar.start();
  const first = await waitFor((snapshot) => snapshot.phase === "ready" && snapshot.pid, "first ready");
  process.kill(first.pid, "SIGKILL");
  const recovered = await waitFor(
    (snapshot) => snapshot.phase === "ready" && snapshot.pid && snapshot.pid !== first.pid,
    "recovered ready",
  );
  console.log(`Harness recovery smoke passed: ${first.pid} -> ${recovered.pid}.`);
} finally {
  await sidecar.stop();
  await rm(userDataPath, { recursive: true, force: true });
}
