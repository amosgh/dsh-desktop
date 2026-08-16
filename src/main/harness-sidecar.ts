import { EventEmitter } from "node:events";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { SidecarSnapshot } from "../shared/contracts.js";
import { parseHarnessUrl, redactLogLine } from "../shared/harness-output.js";

const HARNESS_VERSION = "0.1.0-rc.6";
const STARTUP_TIMEOUT_MS = 25_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_LOG_LINES = 160;
const MAX_RESTART_ATTEMPTS = 5;
const STABLE_RUN_MS = 30_000;

interface HarnessSidecarOptions {
  appPath: string;
  userDataPath: string;
  workspacePath: string;
  executablePath: string;
  getEnvironment?: (() => NodeJS.ProcessEnv) | undefined;
}

export class HarnessSidecar extends EventEmitter {
  #child: ChildProcessWithoutNullStreams | undefined;
  #snapshot: SidecarSnapshot = {
    phase: "idle",
    harnessVersion: HARNESS_VERSION,
    logs: [],
    adapter: { phase: "locked", protocolVersion: "1", authenticated: false },
  };
  #pendingOutput = "";
  #stopRequested = false;
  #restartAttempts = 0;
  #restartTimer: NodeJS.Timeout | undefined;
  #stableTimer: NodeJS.Timeout | undefined;

  constructor(private readonly options: HarnessSidecarOptions) {
    super();
  }

  get snapshot(): SidecarSnapshot {
    return structuredClone(this.#snapshot);
  }

  async start(): Promise<SidecarSnapshot> {
    return this.#start(true);
  }

  async #start(manual: boolean): Promise<SidecarSnapshot> {
    if (this.#snapshot.phase === "ready" || this.#snapshot.phase === "starting") {
      return this.snapshot;
    }
    if (manual) this.#restartAttempts = 0;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;

    const harnessHome = join(this.options.userDataPath, "harness");
    const cliPath = join(
      this.options.appPath,
      "node_modules",
      "@deepseek-ai",
      "dsh",
      "lib",
      "bin.js",
    );
    await access(cliPath);
    await mkdir(harnessHome, { recursive: true });

    this.#stopRequested = false;
    this.#pendingOutput = "";
    this.#setSnapshot({
      phase: "starting",
      harnessVersion: HARNESS_VERSION,
      startedAt: new Date().toISOString(),
      logs: [],
      adapter: { phase: "starting", protocolVersion: "1", authenticated: false },
      restartAttempt: this.#restartAttempts || undefined,
    });

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.getEnvironment?.(),
      DSH_HOME: harnessHome,
    };
    const child = spawn(
      this.options.executablePath,
      [cliPath, "web", "--host", "127.0.0.1", "--port", "0"],
      {
        cwd: this.options.workspacePath,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.#child = child;
    this.#setSnapshot({ ...this.#snapshot, pid: child.pid });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => this.#consumeOutput(chunk));
    child.stderr.on("data", (chunk: string) => this.#appendLogs(chunk));
    child.once("error", (error) => this.#fail(`Harness process error: ${error.message}`));
    child.once("exit", (code, signal) => {
      this.#child = undefined;
      if (this.#stopRequested) {
        this.#setSnapshot({
          ...this.#snapshot,
          phase: "stopped",
          pid: undefined,
          url: undefined,
        });
        return;
      }
      this.#fail(`Harness exited unexpectedly (${signal ?? `code ${code ?? "unknown"}`}).`);
    });

    const timeout = setTimeout(() => {
      if (this.#snapshot.phase === "starting") {
        this.#fail("Harness did not publish a loopback endpoint within 25 seconds.");
        child.kill("SIGTERM");
      }
    }, STARTUP_TIMEOUT_MS);
    timeout.unref();

    return this.snapshot;
  }

  async stop(): Promise<SidecarSnapshot> {
    const child = this.#child;
    if (this.#restartTimer) clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;
    if (this.#stableTimer) clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
    this.#stopRequested = true;
    if (!child) {
      this.#setSnapshot({ ...this.#snapshot, phase: "stopped", pid: undefined, url: undefined });
      return this.snapshot;
    }

    this.#stopRequested = true;
    this.#setSnapshot({ ...this.#snapshot, phase: "stopping" });
    child.kill("SIGTERM");

    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);
        timeout.unref();
      }),
    ]);
    return this.snapshot;
  }

  async restart(): Promise<SidecarSnapshot> {
    await this.stop();
    return this.start();
  }

  async useWorkspace(workspacePath: string): Promise<SidecarSnapshot> {
    if (workspacePath === this.options.workspacePath) return this.snapshot;
    await this.stop();
    this.options.workspacePath = workspacePath;
    return this.start();
  }

  #consumeOutput(chunk: string): void {
    this.#pendingOutput += chunk;
    this.#appendLogs(chunk);
    const url = parseHarnessUrl(this.#pendingOutput);
    if (url && this.#snapshot.phase === "starting") {
      this.#setSnapshot({ ...this.#snapshot, phase: "ready", url });
      this.#stableTimer = setTimeout(() => {
        this.#restartAttempts = 0;
        this.#stableTimer = undefined;
      }, STABLE_RUN_MS);
      this.#stableTimer.unref();
      this.#pendingOutput = "";
    }
  }

  #appendLogs(chunk: string): void {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(redactLogLine);
    if (lines.length === 0) return;
    this.#setSnapshot({
      ...this.#snapshot,
      logs: [...this.#snapshot.logs, ...lines].slice(-MAX_LOG_LINES),
    });
  }

  #fail(message: string): void {
    this.#setSnapshot({
      ...this.#snapshot,
      phase: "error",
      error: redactLogLine(message),
      pid: undefined,
      url: undefined,
    });
    this.#scheduleRestart();
  }

  #scheduleRestart(): void {
    if (this.#stopRequested || this.#restartTimer || this.#restartAttempts >= MAX_RESTART_ATTEMPTS) return;
    if (this.#stableTimer) clearTimeout(this.#stableTimer);
    this.#stableTimer = undefined;
    this.#restartAttempts += 1;
    const delay = Math.min(8_000, 1_000 * 2 ** (this.#restartAttempts - 1));
    this.#setSnapshot({ ...this.#snapshot, restartAttempt: this.#restartAttempts });
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      void this.#start(false).catch((error: unknown) => {
        this.#fail(error instanceof Error ? error.message : String(error));
      });
    }, delay);
    this.#restartTimer.unref();
  }

  #setSnapshot(snapshot: SidecarSnapshot): void {
    this.#snapshot = snapshot;
    this.emit("change", this.snapshot);
  }
}
