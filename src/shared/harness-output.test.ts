import { describe, expect, it } from "vitest";
import { parseHarnessUrl, redactLogLine } from "./harness-output.js";

describe("parseHarnessUrl", () => {
  it("accepts the exact loopback startup line", () => {
    expect(parseHarnessUrl("dsh web: http://127.0.0.1:65434\n")).toBe(
      "http://127.0.0.1:65434",
    );
  });

  it("rejects non-loopback and malformed endpoints", () => {
    expect(parseHarnessUrl("dsh web: http://0.0.0.0:3080")).toBeUndefined();
    expect(parseHarnessUrl("dsh web: https://127.0.0.1:3080")).toBeUndefined();
    expect(parseHarnessUrl("ready on 127.0.0.1")).toBeUndefined();
  });
});

describe("redactLogLine", () => {
  it("removes common credential shapes", () => {
    expect(redactLogLine("Authorization: Bearer sk-secret-value")).toBe(
      "Authorization: Bearer [REDACTED]",
    );
    expect(redactLogLine("api_key=very-secret")).toBe("api_key=[REDACTED]");
    const synthetic = "sk-dsh-desktop-synthetic-secret-123456";
    expect(redactLogLine(`request failed for ${synthetic}`)).not.toContain(synthetic);
    expect(redactLogLine("https://example.test?q=1&access_token=sensitive-value")).toContain("access_token=[REDACTED]");
  });
});
