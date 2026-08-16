import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  safeStorage,
  shell,
  type OpenDialogOptions,
} from "electron";
import { HarnessSidecar } from "./harness-sidecar.js";
import { HarnessGateway } from "./harness-gateway.js";
import type { AdapterSnapshot, ProtocolSnapshot, SettingsSnapshot, SidecarSnapshot, TaskWorkspaceRecord } from "../shared/contracts.js";
import { ProjectStore } from "./project-store.js";
import { assertProjectId, inspectProject } from "./project-inspector.js";
import { HarnessProtocolClient } from "./harness-protocol-client.js";
import { GitService } from "./git-service.js";
import { testModelConnection } from "./model-connection.js";
import { safeSettingsDiagnostics } from "./diagnostics.js";
import { parseWebAddress } from "./browser-policy.js";

let mainWindow: BrowserWindow | undefined;
let harnessWindow: BrowserWindow | undefined;
let browserWindow: BrowserWindow | undefined;
let browserSessionConfigured = false;
let sidecar: HarnessSidecar;
let projectStore: ProjectStore;
let gitService: GitService;
let projectStoreClosed = false;
const gateway = new HarnessGateway();
const protocol = new HarnessProtocolClient();
let gatewayUpstream: string | undefined;
let gatewayEpoch = 0;
let gatewayRetryAttempt = 0;
let gatewayRetryTimer: NodeJS.Timeout | undefined;
const notifiedRequests = new Set<string>();
const currentNotifications = new Map<string, { title: string; body: string }>();
let appliedModelGeneration = 0;
const execFileAsync = promisify(execFile);
let adapter: AdapterSnapshot = {
  phase: "locked",
  protocolVersion: "1",
  authenticated: false,
};

console.log("DSH Desktop main process loaded.");

function publicSnapshot(snapshot = sidecar.snapshot): SidecarSnapshot {
  return {
    ...snapshot,
    url: adapter.endpoint,
    adapter: { ...adapter },
  };
}

function readStoredSecret(): string | undefined {
  const encoded = projectStore.getPreference("deepseek_api_key_encrypted");
  if (!encoded || !safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(encoded, "base64"));
  } catch {
    return undefined;
  }
}

function settingsSnapshot(): SettingsSnapshot {
  return {
    credentialConfigured: Boolean(readStoredSecret()),
    baseURL: projectStore.getPreference("deepseek_base_url") ?? "https://api.deepseek.com",
    model: projectStore.getPreference("deepseek_model") ?? "deepseek-v4-flash",
    editor: projectStore.getPreference("editor") === "system" ? "system" : "vscode",
    telemetry: false,
  };
}

function validateBaseURL(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
    throw new Error("模型端点必须使用 HTTPS；本机回环地址可使用 HTTP。");
  }
  return url.toString().replace(/\/$/, "");
}

function broadcast(snapshot: SidecarSnapshot): void {
  const visibleSnapshot = publicSnapshot(snapshot);
  console.log(
    `Harness state: ${visibleSnapshot.phase}; adapter: ${adapter.phase}${adapter.endpoint ? ` (${adapter.endpoint})` : ""}${visibleSnapshot.error ? ` — ${visibleSnapshot.error}` : ""}`,
  );
  if (visibleSnapshot.phase === "error" && visibleSnapshot.logs.length > 0) {
    console.error(visibleSnapshot.logs.slice(-40).join("\n"));
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("sidecar:changed", visibleSnapshot);
    const capturePath = process.env.DSH_DESKTOP_CAPTURE_PATH;
    if (capturePath && snapshot.phase === "ready" && adapter.phase === "ready") {
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        void mainWindow.webContents
          .capturePage()
          .then((image) => writeFile(capturePath, image.toPNG()))
          .then(() => console.log(`Captured ready runtime to ${capturePath}`))
          .catch((error: unknown) => console.error("Ready-state capture failed.", error));
      }, 300);
    }
    if (process.env.DSH_DESKTOP_OPEN_HARNESS === "1" && snapshot.phase === "ready" && adapter.phase === "ready") {
      process.env.DSH_DESKTOP_OPEN_HARNESS = "0";
      void openHarnessWindow().then((result) => {
        console.log(`Harness window open result: ${JSON.stringify(result)}`);
      });
    }
  }
}

function closeHarnessWindow(): void {
  if (harnessWindow && !harnessWindow.isDestroyed()) harnessWindow.close();
  harnessWindow = undefined;
}

function clearGatewayRetry(): void {
  if (gatewayRetryTimer) clearTimeout(gatewayRetryTimer);
  gatewayRetryTimer = undefined;
}

function scheduleGatewayRetry(snapshot: SidecarSnapshot): void {
  if (gatewayRetryTimer || gatewayRetryAttempt >= 5 || snapshot.phase !== "ready" || !snapshot.url) return;
  gatewayRetryAttempt += 1;
  const expectedUrl = snapshot.url;
  const delay = Math.min(8_000, 500 * 2 ** (gatewayRetryAttempt - 1));
  gatewayRetryTimer = setTimeout(() => {
    gatewayRetryTimer = undefined;
    if (sidecar.snapshot.phase === "ready" && sidecar.snapshot.url === expectedUrl) void reconcileGateway(sidecar.snapshot);
  }, delay);
  gatewayRetryTimer.unref();
}

async function reconcileGateway(snapshot: SidecarSnapshot): Promise<void> {
  if (snapshot.phase !== "ready" || !snapshot.url) {
    clearGatewayRetry();
    gatewayRetryAttempt = 0;
    const epoch = ++gatewayEpoch;
    gatewayUpstream = undefined;
    adapter = { phase: "locked", protocolVersion: "1", authenticated: false };
    closeHarnessWindow();
    protocol.disconnect(false);
    await gateway.stop();
    if (epoch !== gatewayEpoch) return;
    broadcast(snapshot);
    return;
  }
  if (gatewayUpstream === snapshot.url && (["starting", "ready"].includes(adapter.phase) || (adapter.phase === "error" && (Boolean(gatewayRetryTimer) || gatewayRetryAttempt >= 5)))) {
    broadcast(snapshot);
    return;
  }

  const epoch = ++gatewayEpoch;
  if (gatewayUpstream !== snapshot.url) {
    clearGatewayRetry();
    gatewayRetryAttempt = 0;
  }
  gatewayUpstream = snapshot.url;
  protocol.connect(snapshot.url);
  adapter = { phase: "starting", protocolVersion: "1", authenticated: false };
  broadcast(snapshot);
  try {
    const session = await gateway.start(snapshot.url);
    if (epoch !== gatewayEpoch) return;
    adapter = {
      phase: "ready",
      protocolVersion: session.protocolVersion,
      authenticated: true,
      endpoint: session.endpoint,
    };
    clearGatewayRetry();
    gatewayRetryAttempt = 0;
  } catch (error) {
    if (epoch !== gatewayEpoch) return;
    adapter = {
      phase: "error",
      protocolVersion: "1",
      authenticated: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scheduleGatewayRetry(snapshot);
  }
  broadcast(snapshot);
}

function installNavigationGuards(window: BrowserWindow, allowedOrigin?: string): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void openWebAddress(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    try {
      if (allowedOrigin && new URL(target).origin === allowedOrigin) return;
    } catch {
      // Malformed navigation targets are denied below.
    }
    event.preventDefault();
  });
}

async function openWebAddress(value: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const url = parseWebAddress(value);
    if (!browserWindow || browserWindow.isDestroyed()) {
      browserWindow = new BrowserWindow({
        width: 1100,
        height: 760,
        minWidth: 720,
        minHeight: 520,
        title: "DSH 内置浏览器",
        backgroundColor: nativeTheme.shouldUseDarkColors ? "#17171a" : "#ffffff",
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          partition: "dsh-browser-session",
        },
      });
      if (!browserSessionConfigured) {
        browserWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        browserWindow.webContents.session.on("will-download", (event) => event.preventDefault());
        browserSessionConfigured = true;
      }
      browserWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        try {
          void browserWindow?.loadURL(parseWebAddress(target).toString());
        } catch {
          // Unsupported targets remain denied.
        }
        return { action: "deny" };
      });
      const guard = (event: Electron.Event, target: string) => {
        try {
          parseWebAddress(target);
        } catch {
          event.preventDefault();
        }
      };
      browserWindow.webContents.on("will-navigate", guard);
      browserWindow.webContents.on("will-redirect", guard);
      browserWindow.webContents.on("before-input-event", (event, input) => {
        if (!input.meta || input.type !== "keyDown") return;
        if (input.key === "[" && browserWindow?.webContents.canGoBack()) { event.preventDefault(); browserWindow.webContents.goBack(); }
        if (input.key === "]" && browserWindow?.webContents.canGoForward()) { event.preventDefault(); browserWindow.webContents.goForward(); }
        if (input.key.toLowerCase() === "r") { event.preventDefault(); browserWindow?.webContents.reload(); }
      });
      browserWindow.on("closed", () => { browserWindow = undefined; });
    }
    await browserWindow.loadURL(url.toString());
    browserWindow.show();
    browserWindow.focus();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function createMainWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: "hiddenInset",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111114" : "#f7f7f8",
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("closed", () => {
    mainWindow = undefined;
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  installNavigationGuards(mainWindow);

  const developmentUrl = process.env.DSH_DESKTOP_DEV_SERVER_URL;
  const captureView = process.env.DSH_DESKTOP_CAPTURE_VIEW;
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (captureView === "projects" || captureView === "tasks" || captureView === "inbox" || captureView === "settings") url.searchParams.set("view", captureView);
    await mainWindow.loadURL(url.toString());
  } else {
    const rendererPath = join(import.meta.dirname, "../renderer/index.html");
    if (captureView === "projects" || captureView === "tasks" || captureView === "inbox" || captureView === "settings") {
      await mainWindow.loadFile(rendererPath, { search: `view=${captureView}` });
    } else {
      await mainWindow.loadFile(rendererPath);
    }
  }

  const capturePath = process.env.DSH_DESKTOP_CAPTURE_PATH;
  if (capturePath) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const rendererText = await mainWindow.webContents.executeJavaScript(
      "document.body.innerText.slice(0, 500)",
    );
    console.log(`Renderer ready: ${JSON.stringify(rendererText)}`);
    const image = await mainWindow.webContents.capturePage();
    await writeFile(capturePath, image.toPNG());
  }
}

async function openHarnessWindow(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { phase } = sidecar.snapshot;
  const gatewaySession = gateway.session;
  if (phase !== "ready" || adapter.phase !== "ready" || !gatewaySession) {
    return { ok: false, error: "Authenticated Harness adapter is not ready." };
  }
  if (harnessWindow && !harnessWindow.isDestroyed()) {
    harnessWindow.focus();
    return { ok: true };
  }

  harnessWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: "DeepSeek Harness — DSH Desktop",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111114" : "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `dsh-harness-${randomUUID()}`,
    },
  });
  await harnessWindow.webContents.session.cookies.set({
    url: gatewaySession.endpoint,
    name: gatewaySession.cookieName,
    value: gatewaySession.token,
    httpOnly: true,
    sameSite: "strict",
  });
  installNavigationGuards(harnessWindow, gatewaySession.endpoint);
  harnessWindow.webContents.once("did-finish-load", () => {
    console.log(`Harness workspace loaded through authenticated adapter ${gatewaySession.endpoint}`);
  });
  harnessWindow.once("closed", () => {
    harnessWindow = undefined;
  });
  await harnessWindow.loadURL(gatewaySession.endpoint);
  return { ok: true };
}

function installIpc(): void {
  ipcMain.handle("sidecar:get", () => publicSnapshot());
  ipcMain.handle("sidecar:start", () => sidecar.start());
  ipcMain.handle("sidecar:stop", () => sidecar.stop());
  ipcMain.handle("sidecar:restart", () => sidecar.restart());
  ipcMain.handle("harness:open", () => openHarnessWindow());
  ipcMain.handle("browser:open", (_event, url: unknown) => {
    if (typeof url !== "string") return { ok: false, error: "网址无效。" } as const;
    return openWebAddress(url);
  });
  ipcMain.handle("projects:list", () => projectStore.list());
  ipcMain.handle("projects:choose", async () => {
    const options: OpenDialogOptions = {
      title: "选择 Git 仓库",
      buttonLabel: "添加项目",
      defaultPath: app.getPath("documents"),
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true } as const;
    try {
      const inspected = await inspectProject(result.filePaths[0]);
      const added = projectStore.addOrTouch(inspected.name, inspected.path);
      const project = projectStore.activate(added.id);
      if (!project) throw new Error("项目保存后无法读取。");
      await sidecar.useWorkspace(project.path);
      return { ok: true, project } as const;
    } catch (error) {
      return {
        ok: false,
        cancelled: false,
        error: error instanceof Error ? error.message : String(error),
      } as const;
    }
  });
  ipcMain.handle("projects:activate", async (_event, id: unknown) => {
    try {
      assertProjectId(id);
      const existing = projectStore.get(id);
      if (!existing) return { ok: false, error: "项目不存在或已被移除。" } as const;
      const inspected = await inspectProject(existing.path);
      const project = projectStore.activate(id);
      if (!project) return { ok: false, error: "项目不存在或已被移除。" } as const;
      await sidecar.useWorkspace(inspected.path);
      return { ok: true, project } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("projects:remove", async (_event, id: unknown) => {
    try {
      assertProjectId(id);
      const project = projectStore.get(id);
      if (!project) return { ok: false, error: "项目不存在或已被移除。" } as const;
      const confirmation = mainWindow
        ? await dialog.showMessageBox(mainWindow, {
            type: "question",
            message: `从 DSH Desktop 移除“${project.name}”？`,
            detail: "只会移除项目记录，不会删除仓库、分支或任何文件。",
            buttons: ["取消", "移除记录"],
            defaultId: 0,
            cancelId: 0,
          })
        : { response: 0 };
      if (confirmation.response !== 1) return { ok: true } as const;
      if (project.active) await sidecar.useWorkspace(app.getPath("documents"));
      projectStore.remove(id);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("projects:reveal", (_event, id: unknown) => {
    try {
      assertProjectId(id);
      const project = projectStore.get(id);
      if (!project) return { ok: false, error: "项目不存在或已被移除。" } as const;
      shell.showItemInFolder(project.path);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("protocol:get", () => protocol.snapshot);
  ipcMain.handle("protocol:refresh", () => protocol.refresh());
  ipcMain.handle("tasks:create", async (_event, prompt: unknown) => {
    let workspace: TaskWorkspaceRecord | undefined;
    try {
      if (typeof prompt !== "string") throw new Error("任务内容无效。");
      const activeProject = projectStore.list().find((project) => project.active);
      if (!activeProject) throw new Error("请先添加并选择一个项目。");
      const sessionId = randomUUID();
      workspace = await gitService.createWorktree(activeProject.id, activeProject.path, sessionId);
      projectStore.saveTaskWorkspace(workspace);
      protocol.registerTaskWorkspace(sessionId, activeProject.path, workspace.branch, workspace.state);
      await protocol.createTask(workspace.worktreePath, prompt, sessionId);
      return { ok: true, sessionId } as const;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!workspace) return { ok: false, error: message } as const;
      protocol.unregisterTaskWorkspace(workspace.sessionId);
      try {
        await gitService.rollbackWorktree(workspace);
        projectStore.deleteTaskWorkspace(workspace.sessionId);
        return { ok: false, error: message } as const;
      } catch (cleanupError) {
        projectStore.updateTaskWorkspaceState(workspace.sessionId, "missing");
        const cleanupMessage = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        return { ok: false, error: `${message}；自动清理 worktree 失败：${cleanupMessage}` } as const;
      }
    }
  });
  ipcMain.handle("tasks:cancel", async (_event, sessionId: unknown) => {
    try {
      if (typeof sessionId !== "string") throw new Error("任务标识无效。");
      await protocol.cancelTask(sessionId);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("tasks:message", async (_event, sessionId: unknown, prompt: unknown, mode: unknown) => {
    try {
      if (typeof sessionId !== "string" || typeof prompt !== "string" || (mode !== "queue" && mode !== "steer")) throw new Error("任务消息无效。");
      await protocol.sendTaskMessage(sessionId, prompt, mode);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("tasks:rename", async (_event, sessionId: unknown, title: unknown) => {
    try {
      if (typeof sessionId !== "string" || typeof title !== "string") throw new Error("任务名称无效。");
      return { ok: true, title: await protocol.renameTask(sessionId, title) } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("tasks:fork", async (_event, sessionId: unknown, atSeq: unknown) => {
    try {
      if (typeof sessionId !== "string" || (atSeq !== undefined && typeof atSeq !== "number")) throw new Error("分叉参数无效。");
      return { ok: true, sessionId: await protocol.forkTask(sessionId, atSeq) } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("tasks:archive", async (_event, sessionId: unknown) => {
    try {
      if (typeof sessionId !== "string") throw new Error("任务标识无效。");
      await protocol.archiveTask(sessionId);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("approvals:respond", async (_event, approvalId: unknown, outcome: unknown) => {
    try {
      if (typeof approvalId !== "string" || (outcome !== "allowed-once" && outcome !== "rejected")) throw new Error("审批参数无效。");
      await protocol.respondApproval(approvalId, outcome);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("questions:respond", async (_event, requestId: unknown, answers: unknown) => {
    try {
      if (typeof requestId !== "string" || !Array.isArray(answers)) throw new Error("回答参数无效。");
      const normalized = answers.map((answer) => {
        if (!answer || typeof answer !== "object" || typeof answer.id !== "string" || !Array.isArray(answer.selected) || !answer.selected.every((item: unknown) => typeof item === "string")) {
          throw new Error("回答内容无效。");
        }
        return { id: answer.id, selected: answer.selected, ...(typeof answer.custom === "string" && answer.custom.trim() ? { custom: answer.custom.trim() } : {}) };
      });
      await protocol.respondQuestion(requestId, normalized);
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("tasks:timeline", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string") throw new Error("任务标识无效。");
    return protocol.loadTimeline(sessionId, false);
  });
  ipcMain.handle("tasks:timeline-older", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string") throw new Error("任务标识无效。");
    return protocol.loadTimeline(sessionId, true);
  });
  ipcMain.handle("review:get", async (_event, sessionId: unknown) => {
    if (typeof sessionId !== "string") throw new Error("任务标识无效。");
    const workspace = projectStore.getTaskWorkspace(sessionId);
    if (!workspace || workspace.state === "discarded" || workspace.state === "missing") return { sessionId, phase: "unavailable", files: [], additions: 0, deletions: 0, clean: true, error: workspace?.state === "missing" ? "任务 worktree 已丢失或被外部移除。" : undefined } as const;
    return gitService.review(workspace);
  });
  ipcMain.handle("review:diff", async (_event, sessionId: unknown, path: unknown) => {
    try {
      if (typeof sessionId !== "string" || typeof path !== "string") throw new Error("差异参数无效。");
      const workspace = projectStore.getTaskWorkspace(sessionId);
      if (!workspace || workspace.state === "discarded" || workspace.state === "missing") throw new Error("任务 worktree 不可用。");
      return { ok: true, diff: await gitService.diff(workspace, path) } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("review:preview", async (_event, sessionId: unknown, path: unknown) => {
    try {
      if (typeof sessionId !== "string" || typeof path !== "string") throw new Error("预览参数无效。");
      const workspace = projectStore.getTaskWorkspace(sessionId);
      if (!workspace || workspace.state === "discarded" || workspace.state === "missing") throw new Error("任务 worktree 不可用。");
      return { ok: true, preview: await gitService.preview(workspace, path) } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("review:commit", async (_event, sessionId: unknown, message: unknown) => {
    try {
      if (typeof sessionId !== "string" || typeof message !== "string") throw new Error("提交参数无效。");
      const workspace = projectStore.getTaskWorkspace(sessionId);
      if (!workspace || workspace.state === "discarded" || workspace.state === "missing") throw new Error("任务 worktree 不可用。");
      const sha = await gitService.commit(workspace, message);
      projectStore.updateTaskWorkspaceState(sessionId, "committed");
      protocol.registerTaskWorkspace(sessionId, workspace.repositoryPath, workspace.branch, "committed");
      return { ok: true, sha } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("review:discard", async (_event, sessionId: unknown) => {
    try {
      if (typeof sessionId !== "string") throw new Error("任务标识无效。");
      const workspace = projectStore.getTaskWorkspace(sessionId);
      if (!workspace || workspace.state === "discarded") return { ok: true } as const;
      if (workspace.state === "missing") {
        projectStore.updateTaskWorkspaceState(sessionId, "discarded");
        protocol.registerTaskWorkspace(sessionId, workspace.repositoryPath, workspace.branch, "discarded");
        return { ok: true } as const;
      }
      const review = await gitService.review(workspace);
      const detail = review.files.length > 0
        ? `将移除独立 worktree、分支 ${workspace.branch} 以及其中 ${review.files.length} 个变更文件。已提交对象通常仍可通过 Git reflog 恢复。`
        : `将移除独立 worktree 和分支 ${workspace.branch}。项目主检出不会改变。`;
      const result = mainWindow ? await dialog.showMessageBox(mainWindow, { type: "warning", message: "丢弃这个任务的隔离工作区？", detail, buttons: ["取消", "丢弃 worktree"], defaultId: 0, cancelId: 0 }) : { response: 0 };
      if (result.response !== 1) return { ok: false, error: "已取消丢弃操作。" } as const;
      await gitService.discard(workspace);
      projectStore.updateTaskWorkspaceState(sessionId, "discarded");
      protocol.registerTaskWorkspace(sessionId, workspace.repositoryPath, workspace.branch, "discarded");
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("review:open", async (_event, sessionId: unknown, target: unknown) => {
    try {
      if (typeof sessionId !== "string" || !["finder", "terminal", "editor"].includes(String(target))) throw new Error("打开参数无效。");
      const workspace = projectStore.getTaskWorkspace(sessionId);
      if (!workspace || workspace.state === "discarded" || workspace.state === "missing") throw new Error("任务 worktree 不可用。");
      if (target === "finder") {
        const failure = await shell.openPath(workspace.worktreePath);
        if (failure) throw new Error(failure);
      }
      else {
        const args = target === "terminal"
          ? ["-a", "Terminal", workspace.worktreePath]
          : settingsSnapshot().editor === "vscode"
            ? ["-a", "Visual Studio Code", workspace.worktreePath]
            : [workspace.worktreePath];
        await execFileAsync("/usr/bin/open", args);
      }
      return { ok: true } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("settings:get", () => settingsSnapshot());
  ipcMain.handle("settings:save", async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== "object") throw new Error("设置内容无效。");
      const value = input as Record<string, unknown>;
      const baseURL = validateBaseURL(String(value.baseURL ?? ""));
      const model = String(value.model ?? "").trim();
      if (!model || model.length > 160) throw new Error("模型名称无效。");
      if (value.editor !== "vscode" && value.editor !== "system") throw new Error("编辑器设置无效。");
      if (value.clearApiKey === true) projectStore.setPreference("deepseek_api_key_encrypted", "");
      if (typeof value.apiKey === "string" && value.apiKey.trim()) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("macOS Keychain 当前不可用，无法安全保存密钥。");
        projectStore.setPreference("deepseek_api_key_encrypted", safeStorage.encryptString(value.apiKey.trim()).toString("base64"));
      }
      projectStore.setPreference("deepseek_base_url", baseURL);
      projectStore.setPreference("deepseek_model", model);
      projectStore.setPreference("editor", value.editor);
      appliedModelGeneration = 0;
      await sidecar.restart();
      return { ok: true, settings: settingsSnapshot() } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("settings:test", async (_event, input: unknown) => {
    try {
      if (!input || typeof input !== "object") throw new Error("连接参数无效。");
      const value = input as Record<string, unknown>;
      const baseURL = validateBaseURL(String(value.baseURL ?? ""));
      const apiKey = typeof value.apiKey === "string" && value.apiKey.trim() ? value.apiKey.trim() : readStoredSecret();
      if (!apiKey) throw new Error("请先输入 DeepSeek API Key。");
      const models = await testModelConnection(baseURL, apiKey);
      return { ok: true, models } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
  ipcMain.handle("diagnostics:export", async () => {
    try {
      const result = mainWindow ? await dialog.showSaveDialog(mainWindow, { title: "导出诊断信息", defaultPath: `DSH-Desktop-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: "JSON", extensions: ["json"] }] }) : { canceled: true, filePath: undefined };
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true } as const;
      const diagnostics = {
        generatedAt: new Date().toISOString(),
        app: { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform, arch: process.arch },
        runtime: { ...publicSnapshot(), url: undefined, logs: publicSnapshot().logs.slice(-100) },
        protocol: { phase: protocol.snapshot.phase, generation: protocol.snapshot.generation, taskCount: protocol.snapshot.tasks.length, pendingApprovals: protocol.snapshot.approvals.length, pendingQuestions: protocol.snapshot.questions.length, error: protocol.snapshot.error },
        projects: projectStore.list().map((project) => ({ id: project.id, name: project.name, active: project.active })),
        settings: safeSettingsDiagnostics(settingsSnapshot()),
      };
      await writeFile(result.filePath, `${JSON.stringify(diagnostics, null, 2)}\n`, { mode: 0o600 });
      return { ok: true, path: result.filePath } as const;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) } as const;
    }
  });
}

function installMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "DSH Desktop",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { label: "设置…", accelerator: "CmdOrCtrl+,", click: () => mainWindow?.webContents.send("settings:open-requested") },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "项目",
        submenu: [
          {
            label: "添加项目…",
            accelerator: "CmdOrCtrl+O",
            click: () => mainWindow?.webContents.send("projects:choose-requested"),
          },
          {
            label: "新建任务",
            accelerator: "CmdOrCtrl+N",
            click: () => mainWindow?.webContents.send("tasks:new-requested"),
          },
          { type: "separator" },
          { label: "打开 Harness", accelerator: "CmdOrCtrl+Shift+H", click: () => void openHarnessWindow() },
          { label: "重新启动 Harness", accelerator: "CmdOrCtrl+Shift+R", click: () => void sidecar.restart() },
          { type: "separator" },
          { role: "toggleDevTools" },
        ],
      },
      { role: "windowMenu" },
    ]),
  );
}

function deliverNotifications(): void {
  if (!Notification.isSupported() || mainWindow?.isFocused()) return;
  for (const [id, item] of currentNotifications) {
    if (notifiedRequests.has(id)) continue;
    notifiedRequests.add(id);
    const notification = new Notification({ title: item.title, body: item.body, silent: false });
    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
      mainWindow?.webContents.send("inbox:focus");
    });
    notification.show();
  }
}

function syncNotifications(snapshot: ProtocolSnapshot): void {
  const actionable = [
    ...snapshot.approvals.map((approval) => ({ id: `approval:${approval.approvalId}`, title: "任务需要授权", body: approval.reason ?? `${approval.toolName} 请求执行受保护操作` })),
    ...snapshot.questions.map((question) => ({ id: `question:${question.requestId}`, title: "任务等待你的回答", body: question.questions[0]?.question ?? "Harness 需要更多信息" })),
    ...snapshot.tasks.filter((task) => task.readyForReview && ["active", "committed"].includes(task.workspaceState ?? "active") && task.worktreeBranch && !task.archived && !task.error).map((task) => ({ id: `review:${task.sessionId}`, title: "任务可以审阅", body: task.title })),
  ];
  const activeIds = new Set(actionable.map((item) => item.id));
  for (const id of notifiedRequests) if (!activeIds.has(id)) notifiedRequests.delete(id);
  currentNotifications.clear();
  for (const item of actionable) currentNotifications.set(item.id, item);
  deliverNotifications();
}

app.whenReady().then(async () => {
  console.log("Electron app is ready.");
  projectStore = new ProjectStore(join(app.getPath("userData"), "desktop.sqlite"));
  gitService = new GitService(join(app.getPath("userData"), "worktrees"));
  for (const workspace of projectStore.listTaskWorkspaces()) {
    let state = workspace.state;
    if (state !== "discarded") {
      try {
        await access(workspace.worktreePath);
      } catch {
        state = "missing";
        projectStore.updateTaskWorkspaceState(workspace.sessionId, state);
      }
    }
    protocol.registerTaskWorkspace(workspace.sessionId, workspace.repositoryPath, workspace.branch, state);
  }
  const activeProject = projectStore.list().find((project) => project.active);
  sidecar = new HarnessSidecar({
    appPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked") : app.getAppPath(),
    userDataPath: app.getPath("userData"),
    workspacePath: activeProject?.path ?? app.getPath("documents"),
    executablePath: app.isPackaged
      ? join(process.resourcesPath, "runtime", "node")
      : (process.env.DSH_DESKTOP_NODE_PATH ?? "node"),
    getEnvironment: () => {
      const apiKey = readStoredSecret();
      return {
        ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
        DEEPSEEK_BASE_URL: settingsSnapshot().baseURL,
      };
    },
  });
  sidecar.on("change", (snapshot: SidecarSnapshot) => {
    void reconcileGateway(snapshot);
  });
  protocol.on("change", (snapshot: ProtocolSnapshot) => {
    console.log(`Protocol state: ${snapshot.phase}; generation ${snapshot.generation}; tasks ${snapshot.tasks.length}`);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("protocol:changed", snapshot);
    if (snapshot.phase === "connected" && snapshot.generation !== appliedModelGeneration) {
      appliedModelGeneration = snapshot.generation;
      void protocol.updateDefaultModel(settingsSnapshot().model).catch((error: unknown) => console.error("Default model setting failed.", error));
    }
    syncNotifications(snapshot);
  });
  protocol.on("timeline", (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("tasks:timeline-changed", snapshot);
  });
  installIpc();
  installMenu();
  await createMainWindow();
  mainWindow?.on("blur", deliverNotifications);
  void sidecar.start().catch((error: unknown) => {
    console.error("Harness failed before process start.", error);
  });

  app.on("activate", () => {
    void createMainWindow();
  });
}).catch((error: unknown) => {
  console.error("DSH Desktop startup failed.", error);
  app.exit(1);
});

app.on("before-quit", (event) => {
  if (sidecar && !["stopped", "idle"].includes(sidecar.snapshot.phase)) {
    event.preventDefault();
    protocol.disconnect(false);
    void sidecar.stop().finally(() => gateway.stop()).finally(() => {
      if (!projectStoreClosed) {
        projectStore.close();
        projectStoreClosed = true;
      }
      app.exit(0);
    });
  } else if (projectStore && !projectStoreClosed) {
    projectStore.close();
    projectStoreClosed = true;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
