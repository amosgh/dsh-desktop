import type { DesktopTaskSummary, TimelineItem } from "./contracts.js";

export interface RpcSuccess<T> {
  type: "server-response";
  rpcId: string;
  result: { ok: true; value: T };
}

export interface RpcFailure {
  type: "server-response";
  rpcId: string;
  result: { ok: false; error: { code: string; message: string; details: unknown } };
}

export type RpcWireResponse<T> = RpcSuccess<T> | RpcFailure;

export interface SessionListWireItem {
  sessionId: string;
  updatedAt: number;
  running: boolean;
  blank: boolean;
  cwd?: string;
  projections?: { values?: { title?: unknown } };
}

export interface SessionHistoryPage {
  events: Record<string, unknown>[];
  hasMore: boolean;
  projections?: Record<string, unknown> | undefined;
}

export function parseRpcResponse<T>(value: unknown, expectedRpcId: string): T {
  if (!isObject(value) || value.type !== "server-response" || value.rpcId !== expectedRpcId) {
    throw new Error("Harness returned an invalid RPC response envelope.");
  }
  const result = value.result;
  if (!isObject(result) || typeof result.ok !== "boolean") {
    throw new Error("Harness returned an invalid RPC result.");
  }
  if (!result.ok) {
    const error = result.error;
    const message = isObject(error) && typeof error.message === "string"
      ? error.message
      : "Harness RPC failed.";
    throw new Error(message);
  }
  return result.value as T;
}

export function parseSessionList(value: unknown): DesktopTaskSummary[] {
  if (!isObject(value) || !Array.isArray(value.items)) {
    throw new Error("Harness returned an invalid session list.");
  }
  return value.items.map((item, index) => parseSessionItem(item, index));
}

export function parseSessionHistory(value: unknown): SessionHistoryPage {
  if (!isObject(value) || !Array.isArray(value.events) || typeof value.hasMore !== "boolean") {
    throw new Error("Harness returned an invalid session history.");
  }
  return {
    hasMore: value.hasMore,
    events: value.events.map((entry, index) => {
      if (!isObject(entry) || !isObject(entry.event)) {
        throw new Error(`Harness returned an invalid history entry at index ${index}.`);
      }
      return entry.event;
    }),
    projections: isObject(value.projections) && isObject(value.projections.values) ? value.projections.values : undefined,
  };
}

export function parseTaskPlan(value: unknown): Array<{ content: string; status: "pending" | "in_progress" | "completed" }> | undefined {
  if (value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const plan = value.flatMap((item) => {
    if (!isObject(item) || typeof item.content !== "string" || !["pending", "in_progress", "completed"].includes(String(item.status))) return [];
    return [{ content: item.content, status: item.status as "pending" | "in_progress" | "completed" }];
  });
  return plan.length === value.length ? plan : undefined;
}

export function normalizeTimelineEvent(event: Record<string, unknown>): TimelineItem | undefined {
  if (typeof event.type !== "string" || typeof event.seq !== "number" || typeof event.time !== "number" || !isObject(event.data)) {
    return undefined;
  }
  if (event.surfaceOp !== undefined && event.surfaceOp !== "append") return undefined;
  const base = { seq: event.seq, time: event.time };
  switch (event.type) {
    case "user/message": {
      const source = isObject(event.data.source) ? event.data.source : undefined;
      const text = extractContentText(event.data.content);
      if (!text) return undefined;
      if (source?.kind === "user") return { ...base, id: stringOr(event.data.id, `user-${event.seq}`), kind: "user", text };
      const title = source?.form === "notice" && typeof source.summary === "string" ? source.summary : "上下文已更新";
      return { ...base, id: stringOr(event.data.id, `context-${event.seq}`), kind: "context", title, detail: text };
    }
    case "assistant/chunk": {
      const chunk = isObject(event.data.chunk) ? event.data.chunk : undefined;
      if (!chunk || chunk.type !== "text-delta" || typeof chunk.text !== "string") return undefined;
      return {
        ...base,
        id: `assistant-${numberOr(event.data.turn, 0)}-${numberOr(event.data.step, 0)}-text`,
        kind: "assistant",
        text: chunk.text,
        partial: true,
      };
    }
    case "assistant/message": {
      if (!isObject(event.data.message)) return undefined;
      const text = extractContentText(event.data.message.content, "text");
      if (!text) return undefined;
      return {
        ...base,
        id: `assistant-${numberOr(event.data.turn, 0)}-${numberOr(event.data.step, 0)}-text`,
        kind: "assistant",
        text,
      };
    }
    case "tool/call": {
      if (typeof event.data.callId !== "string" || typeof event.data.name !== "string") return undefined;
      return {
        ...base,
        id: `tool-${event.data.callId}`,
        kind: "tool",
        title: event.data.name,
        toolName: event.data.name,
        detail: summarizeToolDetail(event.data.arguments),
        toolState: "running",
      };
    }
    case "tool/result": {
      const message = isObject(event.data.message) ? event.data.message : undefined;
      if (!message) return undefined;
      const source = isObject(message.source) ? message.source : undefined;
      if (!source || typeof source.callId !== "string") return undefined;
      const isError = isObject(event.data.error) || extractToolError(message.content);
      return {
        ...base,
        id: `tool-${source.callId}`,
        kind: "tool",
        title: "工具调用",
        detail: extractContentText(message.content),
        toolState: isError ? "error" : "completed",
      };
    }
    case "turn/end": {
      const reason = typeof event.data.reason === "string" ? event.data.reason : undefined;
      if (!reason || ["completed", "stop", "tool-calls"].includes(reason)) return undefined;
      return { ...base, id: `status-${event.seq}`, kind: "status", title: turnReasonLabel(reason) };
    }
    default:
      return undefined;
  }
}

function extractContentText(value: unknown, blockType?: "text" | "reasoning"): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const text = value.flatMap((block): string[] => {
    if (!isObject(block)) return [];
    if ((block.type === "text" || block.type === "reasoning") && (!blockType || block.type === blockType) && typeof block.text === "string") return [block.text];
    if (block.type === "tool-result") return extractContentText(block.content, blockType)?.split("\n") ?? [];
    return [];
  }).join("\n").trim();
  return text || undefined;
}

function extractToolError(value: unknown): boolean {
  return Array.isArray(value) && value.some((block) => isObject(block) && block.type === "tool-result" && block.isError === true);
}

function summarizeToolDetail(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}

function turnReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    aborted: "任务已中止",
    cancelled: "任务已取消",
    interrupted: "任务被打断",
    error: "任务发生错误",
    "max-tokens": "已达到输出上限",
    blocked: "任务等待处理",
  };
  return labels[reason] ?? `任务结束：${reason}`;
}

export function parseServerFrame(value: unknown): { rpcId: string; payload: Record<string, unknown> } | undefined {
  if (!isObject(value) || value.type !== "server-request" || typeof value.rpcId !== "string") return undefined;
  if (!isObject(value.payload) || typeof value.payload.type !== "string") return undefined;
  return { rpcId: value.rpcId, payload: value.payload };
}

function parseSessionItem(value: unknown, index: number): DesktopTaskSummary {
  if (
    !isObject(value)
    || typeof value.sessionId !== "string"
    || typeof value.updatedAt !== "number"
    || typeof value.running !== "boolean"
    || typeof value.blank !== "boolean"
  ) {
    throw new Error(`Harness returned an invalid session at index ${index}.`);
  }
  const projections = isObject(value.projections) && isObject(value.projections.values)
    ? value.projections.values
    : undefined;
  const title = typeof projections?.title === "string" && projections.title.trim()
    ? projections.title.trim()
    : value.blank
      ? "新任务"
      : `任务 ${value.sessionId.slice(0, 8)}`;
  return {
    sessionId: value.sessionId,
    title,
    updatedAt: value.updatedAt,
    running: value.running,
    blank: value.blank,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    pendingApprovals: 0,
    archived: false,
    readyForReview: !value.running && !value.blank,
  };
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
