import { describe, expect, it } from "vitest";
import { normalizeTimelineEvent, parseRpcResponse, parseServerFrame, parseSessionHistory, parseSessionList, parseTaskPlan } from "./harness-protocol.js";

describe("Harness protocol normalization", () => {
  it("normalizes session summaries and title projections", () => {
    expect(parseSessionList({
      items: [{
        sessionId: "session-1",
        updatedAt: 123,
        running: true,
        blank: false,
        cwd: "/repo",
        projections: { values: { title: "修复登录流程" } },
      }],
    })).toEqual([{
      sessionId: "session-1",
      title: "修复登录流程",
      updatedAt: 123,
      running: true,
      blank: false,
      cwd: "/repo",
      pendingApprovals: 0,
      archived: false,
      readyForReview: false,
    }]);
  });

  it("rejects mismatched rpc ids and surfaces Harness errors", () => {
    expect(() => parseRpcResponse({
      type: "server-response",
      rpcId: "other",
      result: { ok: true, value: {} },
    }, "expected")).toThrow("invalid RPC response envelope");
    expect(() => parseRpcResponse({
      type: "server-response",
      rpcId: "expected",
      result: { ok: false, error: { code: "internal", message: "boom", details: {} } },
    }, "expected")).toThrow("boom");
  });

  it("drops malformed server frames", () => {
    expect(parseServerFrame({ type: "server-request", rpcId: "1", payload: { type: "host/session-status" } }))
      .toEqual({ rpcId: "1", payload: { type: "host/session-status" } });
    expect(parseServerFrame({ type: "server-request", rpcId: "1", payload: null })).toBeUndefined();
  });

  it("parses history pages and normalizes user, stream and tool events", () => {
    expect(parseSessionHistory({ events: [{ event: { type: "turn/start", seq: 1, time: 10, data: { turn: 1 } } }], hasMore: true })).toMatchObject({ hasMore: true });
    expect(normalizeTimelineEvent({
      type: "user/message", seq: 2, time: 11, surfaceOp: "append",
      data: { id: "m1", source: { kind: "user" }, content: [{ type: "text", text: "修复登录" }] },
    })).toMatchObject({ id: "m1", kind: "user", text: "修复登录" });
    expect(normalizeTimelineEvent({
      type: "assistant/chunk", seq: 3, time: 12,
      data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 0, text: "正在检查" } },
    })).toMatchObject({ id: "assistant-1-1-text", kind: "assistant", partial: true });
    expect(normalizeTimelineEvent({
      type: "tool/call", seq: 4, time: 13,
      data: { turn: 1, step: 1, callId: "c1", name: "read_file", arguments: "{\"path\":\"README.md\"}" },
    })).toMatchObject({ id: "tool-c1", toolName: "read_file", toolState: "running" });
  });

  it("skips model-only surface replacements", () => {
    expect(normalizeTimelineEvent({
      type: "assistant/message", seq: 10, time: 20, surfaceOp: { op: "replace", start: 1, end: 9 },
      data: { turn: 1, step: 1, message: { content: [{ type: "text", text: "summary" }] } },
    })).toBeUndefined();
  });

  it("validates the task plan projection", () => {
    expect(parseTaskPlan([{ content: "检查实现", status: "completed" }, { content: "补测试", status: "in_progress" }])).toHaveLength(2);
    expect(parseTaskPlan([{ content: "坏数据", status: "unknown" }])).toBeUndefined();
  });

  it("normalizes a 10,000-event replay with stable identities", () => {
    const items = Array.from({ length: 10_000 }, (_, index) => normalizeTimelineEvent({
      type: "user/message",
      seq: index + 1,
      time: 1_700_000_000_000 + index,
      surfaceOp: "append",
      data: { id: `message-${index}`, source: { kind: "user" }, content: [{ type: "text", text: `事件 ${index}` }] },
    }));
    expect(items).toHaveLength(10_000);
    expect(new Set(items.map((item) => item?.id)).size).toBe(10_000);
    expect(items.at(-1)).toMatchObject({ id: "message-9999", seq: 10_000 });
  });
});
