import { describe, expect, it } from "vitest";
import { parseWebAddress } from "./browser-policy.js";

describe("parseWebAddress", () => {
  it("accepts HTTP and HTTPS network addresses", () => {
    expect(parseWebAddress("https://example.com/docs").toString()).toBe("https://example.com/docs");
    expect(parseWebAddress("http://127.0.0.1:8080/").origin).toBe("http://127.0.0.1:8080");
  });

  it("rejects local files, executable schemes, and embedded credentials", () => {
    expect(() => parseWebAddress("file:///tmp/readme.md")).toThrow("HTTP");
    expect(() => parseWebAddress("javascript:alert(1)")).toThrow("HTTP");
    expect(() => parseWebAddress("https://user:secret@example.com")).toThrow("用户名或密码");
  });
});
