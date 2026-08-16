import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { DesktopTaskSummary, PendingApproval, PendingQuestion, PendingQuestionItem, ProtocolSnapshot, TaskTimelineSnapshot, TimelineItem } from "../shared/contracts.js";
import { isObject, normalizeTimelineEvent, parseRpcResponse, parseServerFrame, parseSessionHistory, parseSessionList, parseTaskPlan } from "../shared/harness-protocol.js";

const RPC_TIMEOUT_MS = 10_000;
const STREAM_OPEN_TIMEOUT_MS = 5_000;
const MAX_PROMPT_CHARS = 20_000;
const HISTORY_PAGE_MESSAGES = 40;

export class HarnessProtocolClient extends EventEmitter {
  #snapshot: ProtocolSnapshot = { phase: "disconnected", generation: 0, tasks: [], approvals: [], questions: [] };
  #tasks = new Map<string, DesktopTaskSummary>();
  #approvals = new Map<string, PendingApproval & { rpcId: string }>();
  #questions = new Map<string, PendingQuestion & { rpcId: string }>();
  #toolCalls = new Map<string, { name: string; detail?: string }>();
  #archived = new Set<string>();
  #workspaceMeta = new Map<string, { projectPath: string; branch: string; state: DesktopTaskSummary["workspaceState"] }>();
  #timelines = new Map<string, TaskTimelineSnapshot>();
  #upstream: URL | undefined;
  #epoch = 0;
  #attempt = 0;
  #retryTimer: NodeJS.Timeout | undefined;
  #sockets = new Set<WebSocket>();
  #defaultModel = "deepseek-v4-flash";

  get snapshot(): ProtocolSnapshot {
    return structuredClone(this.#snapshot);
  }

  connect(upstreamOrigin: string): void {
    this.disconnect(false);
    const upstream = new URL(upstreamOrigin);
    if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1") {
      this.#setSnapshot({ ...this.#snapshot, phase: "error", error: "Protocol refused a non-loopback endpoint." });
      return;
    }
    this.#upstream = upstream;
    const epoch = ++this.#epoch;
    this.#attempt = 0;
    void this.#establish(epoch, false);
  }

  disconnect(clearTasks = false): void {
    this.#epoch += 1;
    this.#upstream = undefined;
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    this.#closeSockets();
    if (clearTasks) {
      this.#tasks.clear();
      this.#approvals.clear();
      this.#questions.clear();
      this.#toolCalls.clear();
      this.#archived.clear();
      this.#workspaceMeta.clear();
    }
    this.#setSnapshot({
      phase: "disconnected",
      generation: this.#snapshot.generation,
      tasks: this.#taskList(),
      approvals: this.#approvalList(),
      questions: this.#questionList(),
    });
  }

  async refresh(): Promise<ProtocolSnapshot> {
    if (!this.#upstream) return this.snapshot;
    const [value, workspaceValue] = await Promise.all([
      this.#rpc<unknown>("session.list", {}),
      this.#rpc<unknown>("workspace.list", {}).catch(() => undefined),
    ]);
    const tasks = parseSessionList(value);
    if (isObject(workspaceValue) && Array.isArray(workspaceValue.archivedSessionIds)) {
      this.#archived = new Set(workspaceValue.archivedSessionIds.filter((id): id is string => typeof id === "string"));
    }
    this.#tasks = new Map(tasks.map((task) => {
      const approvals = [...this.#approvals.values()].filter((approval) => approval.sessionId === task.sessionId).length;
      const meta = this.#workspaceMeta.get(task.sessionId);
      return [task.sessionId, { ...task, pendingApprovals: approvals, archived: this.#archived.has(task.sessionId), ...(meta ? { projectPath: meta.projectPath, worktreeBranch: meta.branch, workspaceState: meta.state } : {}) }];
    }));
    this.#publish();
    return this.snapshot;
  }

  registerTaskWorkspace(sessionId: string, projectPath: string, branch: string, state: DesktopTaskSummary["workspaceState"] = "active"): void {
    this.#workspaceMeta.set(sessionId, { projectPath, branch, state });
    this.#updateTask(sessionId, { projectPath, worktreeBranch: branch, workspaceState: state });
  }

  unregisterTaskWorkspace(sessionId: string): void {
    this.#workspaceMeta.delete(sessionId);
    this.#tasks.delete(sessionId);
    this.#timelines.delete(sessionId);
    this.#publish();
  }

  async createTask(cwd: string, prompt: string, preallocatedSessionId?: string): Promise<string> {
    if (this.#snapshot.phase !== "connected") throw new Error("Harness 协议尚未连接。");
    const content = prompt.trim();
    if (!content) throw new Error("请输入任务内容。");
    if (content.length > MAX_PROMPT_CHARS) throw new Error(`任务内容不能超过 ${MAX_PROMPT_CHARS} 个字符。`);
    const sessionId = preallocatedSessionId ?? randomUUID();
    this.#assertSessionId(sessionId);
    let created = false;
    try {
      await this.#rpc("session.create", { sessionId, cwd });
      created = true;
      await this.#rpc("session.selectModel", { sessionId, provider: "deepseek-official", model: this.#defaultModel });
      await this.#rpc("session.prompt", {
        sessionId,
        mode: "queue",
        content: [{ type: "text", text: content }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    } catch (error) {
      if (created) await this.#rpc("workspace.archiveSession", { sessionId }).catch(() => undefined);
      throw error;
    }
    const workspaceMeta = this.#workspaceMeta.get(sessionId);
    this.#tasks.set(sessionId, {
      sessionId,
      title: content.split(/\s+/).slice(0, 8).join(" ").slice(0, 80),
      updatedAt: Date.now(),
      running: true,
      blank: false,
      cwd,
      pendingApprovals: 0,
      archived: false,
      readyForReview: false,
      ...(workspaceMeta ? { projectPath: workspaceMeta.projectPath, worktreeBranch: workspaceMeta.branch, workspaceState: workspaceMeta.state } : {}),
    });
    this.#publish();
    return sessionId;
  }

  async cancelTask(sessionId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid session identifier.");
    await this.#rpc("session.cancel", { sessionId });
    this.#updateTask(sessionId, { running: false, readyForReview: false, updatedAt: Date.now() });
  }

  async sendTaskMessage(sessionId: string, prompt: string, mode: "queue" | "steer"): Promise<void> {
    this.#assertSessionId(sessionId);
    const content = prompt.trim();
    if (!content) throw new Error("请输入任务内容。");
    if (content.length > MAX_PROMPT_CHARS) throw new Error(`任务内容不能超过 ${MAX_PROMPT_CHARS} 个字符。`);
    await this.#rpc("session.prompt", {
      sessionId,
      mode,
      content: [{ type: "text", text: content }],
      clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    this.#updateTask(sessionId, { running: true, readyForReview: false, updatedAt: Date.now(), error: undefined });
  }

  async renameTask(sessionId: string, title: string): Promise<string> {
    this.#assertSessionId(sessionId);
    const normalized = title.trim();
    if (!normalized) throw new Error("任务名称不能为空。");
    const value = await this.#rpc<unknown>("session.rename", { sessionId, title: normalized });
    if (!isObject(value) || typeof value.title !== "string") throw new Error("Harness returned an invalid rename result.");
    this.#updateTask(sessionId, { title: value.title, updatedAt: Date.now() });
    return value.title;
  }

  async forkTask(sessionId: string, atSeq?: number): Promise<string> {
    this.#assertSessionId(sessionId);
    if (atSeq !== undefined && (!Number.isSafeInteger(atSeq) || atSeq < 0)) throw new Error("分叉位置无效。");
    const value = await this.#rpc<unknown>("session.fork", { sessionId, ...(atSeq !== undefined ? { atSeq } : {}) });
    if (!isObject(value) || typeof value.sessionId !== "string") throw new Error("Harness returned an invalid fork result.");
    await this.refresh();
    return value.sessionId;
  }

  async archiveTask(sessionId: string): Promise<void> {
    this.#assertSessionId(sessionId);
    const value = await this.#rpc<unknown>("workspace.archiveSession", { sessionId });
    if (!isObject(value) || !Array.isArray(value.archivedSessionIds)) throw new Error("Harness returned an invalid archive result.");
    this.#archived = new Set(value.archivedSessionIds.filter((id): id is string => typeof id === "string"));
    this.#updateTask(sessionId, { archived: true, updatedAt: Date.now() });
  }

  async updateDefaultModel(model: string): Promise<void> {
    const normalized = model.trim();
    if (!normalized) throw new Error("模型名称不能为空。");
    this.#defaultModel = normalized;
  }

  async respondApproval(approvalId: string, outcome: "allowed-once" | "rejected"): Promise<void> {
    const approval = this.#approvals.get(approvalId);
    if (!approval) throw new Error("该审批已失效或已处理。");
    if (approval.state === "resolving") throw new Error("该审批正在处理，请勿重复提交。");
    if (outcome !== "allowed-once" && outcome !== "rejected") throw new Error("审批结果无效。");
    this.#approvals.set(approvalId, { ...approval, state: "resolving" });
    this.#publish();
    try {
      await this.#respond(approval.rpcId, { sessionId: approval.sessionId, approvalId, outcome });
    } catch (error) {
      const current = this.#approvals.get(approvalId);
      if (current) this.#approvals.set(approvalId, { ...current, state: "pending" });
      this.#publish();
      throw error;
    }
  }

  async respondQuestion(requestId: string, answers: Array<{ id: string; selected: string[]; custom?: string }>): Promise<void> {
    const pending = this.#questions.get(requestId);
    if (!pending) throw new Error("该问题已失效或已处理。");
    if (pending.state === "resolving") throw new Error("回答正在提交，请勿重复操作。");
    const expected = new Set(pending.questions.map((question) => question.id));
    if (answers.length !== expected.size || answers.some((answer) => !expected.has(answer.id) || !Array.isArray(answer.selected))) {
      throw new Error("回答内容不完整。");
    }
    this.#questions.set(requestId, { ...pending, state: "resolving" });
    this.#publish();
    try {
      await this.#respond(pending.rpcId, { sessionId: pending.sessionId, answer: { answers } });
    } catch (error) {
      const current = this.#questions.get(requestId);
      if (current) this.#questions.set(requestId, { ...current, state: "pending" });
      this.#publish();
      throw error;
    }
  }

  async loadTimeline(sessionId: string, older = false): Promise<TaskTimelineSnapshot> {
    this.#assertSessionId(sessionId);
    const current = this.#timelines.get(sessionId);
    if (older && (!current || !current.hasMore || current.phase === "loading")) {
      return current ? structuredClone(current) : this.#emptyTimeline(sessionId);
    }
    const loading: TaskTimelineSnapshot = {
      ...(current ?? this.#emptyTimeline(sessionId)),
      phase: "loading",
      error: undefined,
    };
    this.#setTimeline(loading);
    try {
      const value = await this.#rpc<unknown>("session.history", {
        sessionId,
        ...(older && current?.beforeSeq !== undefined ? { beforeSeq: current.beforeSeq } : {}),
        maxMessages: HISTORY_PAGE_MESSAGES,
      });
      const page = parseSessionHistory(value);
      const pageItems = this.#foldTimelineEvents(page.events);
      const rawSeqs = page.events.map((event) => event.seq).filter((seq): seq is number => typeof seq === "number");
      const pageMaxSeq = rawSeqs.length > 0 ? Math.max(...rawSeqs) : -1;
      const items = older && current
        ? this.#mergeTimelineItems(pageItems, current.items)
        : current
          ? this.#overlayTimelineItems(pageItems, current.items.filter((item) => item.seq > pageMaxSeq))
          : pageItems;
      const snapshot: TaskTimelineSnapshot = {
        sessionId,
        phase: "ready",
        items,
        hasMore: page.hasMore,
        plan: older ? current?.plan : parseTaskPlan(page.projections?.todos),
        beforeSeq: rawSeqs.length > 0 ? Math.min(...rawSeqs) : current?.beforeSeq,
      };
      this.#setTimeline(snapshot);
      return structuredClone(snapshot);
    } catch (error) {
      const snapshot: TaskTimelineSnapshot = {
        ...(current ?? this.#emptyTimeline(sessionId)),
        phase: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      this.#setTimeline(snapshot);
      return structuredClone(snapshot);
    }
  }

  async #establish(epoch: number, recovering: boolean): Promise<void> {
    if (epoch !== this.#epoch || !this.#upstream) return;
    this.#setSnapshot({
      ...this.#snapshot,
      phase: recovering ? "recovering" : "connecting",
      error: undefined,
    });
    try {
      await this.refresh();
      this.#approvals.clear();
      this.#questions.clear();
      for (const [id, task] of this.#tasks) this.#tasks.set(id, { ...task, pendingApprovals: 0 });
      this.#publish();
      await Promise.all([
        this.#openStream("events.mux", epoch),
        this.#openStream("events.host", epoch),
      ]);
      if (recovering && this.#timelines.size > 0) {
        await Promise.all([...this.#timelines.keys()].map((sessionId) => this.loadTimeline(sessionId, false)));
      }
      if (epoch !== this.#epoch) return;
      this.#attempt = 0;
      this.#setSnapshot({
        phase: "connected",
        generation: this.#snapshot.generation + 1,
        connectedAt: new Date().toISOString(),
        tasks: this.#taskList(),
        approvals: this.#approvalList(),
        questions: this.#questionList(),
      });
    } catch (error) {
      if (epoch !== this.#epoch) return;
      this.#scheduleRecovery(epoch, error);
    }
  }

  #openStream(name: "events.mux" | "events.host", epoch: number): Promise<void> {
    const upstream = this.#upstream;
    if (!upstream) return Promise.reject(new Error("Harness endpoint is unavailable."));
    const url = new URL(`/api/${name}`, upstream);
    url.protocol = "ws:";
    const socket = new WebSocket(url);
    this.#sockets.add(socket);
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error(`${name} did not open within 5 seconds.`));
      }, STREAM_OPEN_TIMEOUT_MS);
      timeout.unref();
      let opened = false;
      socket.addEventListener("open", () => {
        opened = true;
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      socket.addEventListener("message", (event) => {
        if (epoch !== this.#epoch || typeof event.data !== "string") return;
        try {
          const envelope = parseServerFrame(JSON.parse(event.data));
          if (envelope) this.#handleFrame(envelope.payload, envelope.rpcId);
        } catch {
          // Malformed frames are dropped; the next reconnect baseline repairs state.
        }
      });
      socket.addEventListener("error", () => {
        if (!opened) {
          clearTimeout(timeout);
          reject(new Error(`${name} failed to open.`));
        }
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        this.#sockets.delete(socket);
        if (epoch !== this.#epoch) return;
        if (!opened) reject(new Error(`${name} closed before opening.`));
        else this.#scheduleRecovery(epoch, new Error(`${name} disconnected.`));
      }, { once: true });
    });
  }

  #scheduleRecovery(epoch: number, error: unknown): void {
    if (epoch !== this.#epoch || this.#retryTimer) return;
    this.#closeSockets();
    this.#attempt += 1;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.#attempt - 1, 5));
    this.#setSnapshot({
      ...this.#snapshot,
      phase: this.#attempt > 5 ? "error" : "recovering",
      error: error instanceof Error ? error.message : String(error),
    });
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.#establish(epoch, true);
    }, delay);
    this.#retryTimer.unref();
  }

  #handleFrame(frame: Record<string, unknown>, rpcId: string): void {
    const type = frame.type;
    const sessionId = typeof frame.sessionId === "string" ? frame.sessionId : undefined;
    if (type === "host/session-removed" && sessionId) {
      this.#tasks.delete(sessionId);
      for (const [id, approval] of this.#approvals) if (approval.sessionId === sessionId) this.#approvals.delete(id);
      for (const [id, question] of this.#questions) if (question.sessionId === sessionId) this.#questions.delete(id);
      this.#timelines.delete(sessionId);
      this.#publish();
      return;
    }
    if (type === "host/session-added" && sessionId) {
      const workspaceMeta = this.#workspaceMeta.get(sessionId);
      this.#tasks.set(sessionId, {
        sessionId,
        title: "新任务",
        updatedAt: Date.now(),
        running: false,
        blank: frame.blank === true,
        cwd: typeof frame.cwd === "string" ? frame.cwd : undefined,
        pendingApprovals: 0,
        archived: false,
        readyForReview: false,
        ...(workspaceMeta ? { projectPath: workspaceMeta.projectPath, worktreeBranch: workspaceMeta.branch, workspaceState: workspaceMeta.state } : {}),
      });
      this.#publish();
      return;
    }
    if (type === "host/session-status" && sessionId && typeof frame.running === "boolean") {
      this.#updateTask(sessionId, { running: frame.running, readyForReview: !frame.running, blank: false, updatedAt: Date.now() });
      return;
    }
    if (type === "host/agent-error" && sessionId) {
      this.#updateTask(sessionId, {
        running: false,
        readyForReview: false,
        error: typeof frame.message === "string" ? frame.message : "Harness agent failed.",
        updatedAt: Date.now(),
      });
      return;
    }
    if (type === "host/archived-sessions-changed" && Array.isArray(frame.archivedSessionIds)) {
      this.#archived = new Set(frame.archivedSessionIds.filter((id): id is string => typeof id === "string"));
      for (const [id, task] of this.#tasks) this.#tasks.set(id, { ...task, archived: this.#archived.has(id) });
      this.#publish();
      return;
    }
    if (type === "session/subscribed" && sessionId && typeof frame.lastSeq === "number") {
      this.#updateTask(sessionId, { lastSeq: frame.lastSeq });
      return;
    }
    if (type === "session/event" && sessionId && isObject(frame.event)) {
      const seq = typeof frame.event.seq === "number" ? frame.event.seq : undefined;
      const time = typeof frame.event.time === "number" ? frame.event.time : Date.now();
      const current = this.#tasks.get(sessionId);
      if (seq !== undefined && current?.lastSeq !== undefined && seq <= current.lastSeq) return;
      this.#updateTask(sessionId, { lastSeq: seq, updatedAt: time, blank: false });
      if (frame.event.type === "tool/call" && isObject(frame.event.data) && typeof frame.event.data.callId === "string" && typeof frame.event.data.name === "string") {
        const detail = typeof frame.event.data.arguments === "string" ? frame.event.data.arguments : undefined;
        this.#toolCalls.set(`${sessionId}:${frame.event.data.callId}`, { name: frame.event.data.name, ...(detail ? { detail } : {}) });
      }
      const timeline = this.#timelines.get(sessionId);
      if (timeline) {
        const next = normalizeTimelineEvent(frame.event);
        if (next) {
          const items = this.#mergeTimelineItems(timeline.items, [next]);
          if (frame.event.type === "assistant/message" && isObject(frame.event.data)) {
            const reasoningId = `assistant-${typeof frame.event.data.turn === "number" ? frame.event.data.turn : 0}-${typeof frame.event.data.step === "number" ? frame.event.data.step : 0}-reasoning`;
            const reasoningIndex = items.findIndex((item) => item.id === reasoningId && item.partial);
            if (reasoningIndex >= 0) items.splice(reasoningIndex, 1);
          }
          this.#setTimeline({ ...timeline, phase: "ready", items });
        }
      }
      return;
    }
    if (type === "session/projection" && sessionId && frame.key === "title" && typeof frame.value === "string") {
      this.#updateTask(sessionId, { title: frame.value, updatedAt: Date.now() });
      return;
    }
    if (type === "session/projection" && sessionId && frame.key === "todos") {
      const timeline = this.#timelines.get(sessionId);
      const plan = parseTaskPlan(frame.value);
      if (timeline && plan) this.#setTimeline({ ...timeline, plan });
      return;
    }
    if (type === "approval/requested" && sessionId && typeof frame.approvalId === "string") {
      const callId = typeof frame.callId === "string" ? frame.callId : undefined;
      const tool = callId ? this.#toolCalls.get(`${sessionId}:${callId}`) : undefined;
      this.#approvals.set(frame.approvalId, {
        rpcId,
        approvalId: frame.approvalId,
        sessionId,
        toolName: typeof frame.toolName === "string" ? frame.toolName : tool?.name ?? "未知工具",
        callId,
        reason: typeof frame.reason === "string" ? frame.reason : undefined,
        detail: tool?.detail,
        requestedAt: Date.now(),
        state: "pending",
      });
      this.#updateApprovalCount(sessionId);
      return;
    }
    if (type === "approval/resolved" && sessionId && typeof frame.approvalId === "string") {
      this.#approvals.delete(frame.approvalId);
      this.#updateApprovalCount(sessionId);
      return;
    }
    if (type === "question/requested" && sessionId && Array.isArray(frame.questions)) {
      const questions = frame.questions.map((question) => this.#parseQuestion(question)).filter((question): question is PendingQuestionItem => Boolean(question));
      if (questions.length !== frame.questions.length) return;
      this.#questions.set(rpcId, { rpcId, requestId: rpcId, sessionId, questions, requestedAt: Date.now(), state: "pending" });
      this.#publish();
      return;
    }
    if (type === "question/resolved" && sessionId && typeof frame.questionRpcId === "string") {
      this.#questions.delete(frame.questionRpcId);
      this.#publish();
    }
  }

  #parseQuestion(value: unknown): PendingQuestionItem | undefined {
    if (!isObject(value) || typeof value.id !== "string" || typeof value.question !== "string") return undefined;
    const options = Array.isArray(value.options) ? value.options.flatMap((option) => {
      if (!isObject(option) || typeof option.label !== "string") return [];
      return [{ label: option.label, description: typeof option.description === "string" ? option.description : undefined }];
    }) : [];
    const intent = isObject(value.intent) && value.intent.kind === "plan-review" && typeof value.intent.approve === "string"
      ? { kind: "plan-review" as const, approve: value.intent.approve }
      : undefined;
    return {
      id: value.id,
      question: value.question,
      detail: typeof value.detail === "string" ? value.detail : undefined,
      header: typeof value.header === "string" ? value.header : undefined,
      options,
      multiSelect: value.multiSelect === true,
      intent,
    };
  }

  async #rpc<T = unknown>(method: string, payload: unknown): Promise<T> {
    const upstream = this.#upstream;
    if (!upstream) throw new Error("Harness endpoint is unavailable.");
    const rpcId = randomUUID();
    const response = await fetch(new URL(`/api/${method}`, upstream), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-request", rpcId, method, payload }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Harness transport failed with HTTP ${response.status}.`);
    return parseRpcResponse<T>(await response.json(), rpcId);
  }

  async #respond(rpcId: string, value: unknown): Promise<void> {
    const upstream = this.#upstream;
    if (!upstream) throw new Error("Harness endpoint is unavailable.");
    const response = await fetch(new URL("/api/respond", upstream), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "client-response", rpcId, result: { ok: true, value } }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Harness response transport failed with HTTP ${response.status}.`);
  }

  #updateTask(sessionId: string, patch: Partial<DesktopTaskSummary>): void {
    const current = this.#tasks.get(sessionId);
    if (!current) return;
    this.#tasks.set(sessionId, { ...current, ...patch });
    this.#publish();
  }

  #foldTimelineEvents(events: Record<string, unknown>[]): TimelineItem[] {
    return events.reduce<TimelineItem[]>((items, event) => {
      const item = normalizeTimelineEvent(event);
      return item ? this.#mergeTimelineItems(items, [item]) : items;
    }, []);
  }

  #mergeTimelineItems(...groups: TimelineItem[][]): TimelineItem[] {
    const merged = new Map<string, TimelineItem>();
    for (const item of groups.flat()) {
      const previous = merged.get(item.id);
      if (previous && previous.partial && item.partial) {
        merged.set(item.id, { ...previous, ...item, seq: item.seq, time: item.time, text: `${previous.text ?? ""}${item.text ?? ""}` });
      } else {
        merged.set(item.id, { ...previous, ...item });
      }
    }
    return [...merged.values()].sort((a, b) => a.seq - b.seq);
  }

  #overlayTimelineItems(...groups: TimelineItem[][]): TimelineItem[] {
    const merged = new Map<string, TimelineItem>();
    for (const item of groups.flat()) merged.set(item.id, { ...merged.get(item.id), ...item });
    return [...merged.values()].sort((a, b) => a.seq - b.seq);
  }

  #emptyTimeline(sessionId: string): TaskTimelineSnapshot {
    return { sessionId, phase: "idle", items: [], hasMore: false };
  }

  #setTimeline(snapshot: TaskTimelineSnapshot): void {
    this.#timelines.set(snapshot.sessionId, snapshot);
    this.emit("timeline", structuredClone(snapshot));
  }

  #assertSessionId(sessionId: string): void {
    if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("Invalid session identifier.");
  }

  #publish(): void {
    this.#setSnapshot({ ...this.#snapshot, tasks: this.#taskList(), approvals: this.#approvalList(), questions: this.#questionList() });
  }

  #taskList(): DesktopTaskSummary[] {
    return [...this.#tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  #approvalList(): PendingApproval[] {
    return [...this.#approvals.values()].map(({ rpcId: _rpcId, ...approval }) => approval).sort((a, b) => a.requestedAt - b.requestedAt);
  }

  #questionList(): PendingQuestion[] {
    return [...this.#questions.values()].map(({ rpcId: _rpcId, ...question }) => question).sort((a, b) => a.requestedAt - b.requestedAt);
  }

  #updateApprovalCount(sessionId: string): void {
    const pendingApprovals = [...this.#approvals.values()].filter((approval) => approval.sessionId === sessionId).length;
    this.#updateTask(sessionId, { pendingApprovals });
  }

  #closeSockets(): void {
    for (const socket of this.#sockets) socket.close();
    this.#sockets.clear();
  }

  #setSnapshot(snapshot: ProtocolSnapshot): void {
    this.#snapshot = snapshot;
    this.emit("change", this.snapshot);
  }
}
