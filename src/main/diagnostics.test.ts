import { describe, expect, it } from "vitest";
import { safeSettingsDiagnostics } from "./diagnostics.js";

describe("safeSettingsDiagnostics", () => {
  it("never exports the configured model endpoint", () => {
    const result = safeSettingsDiagnostics({
      credentialConfigured: true,
      baseURL: "https://private-gateway.example/v1/tenant-secret",
      model: "private-model",
      editor: "vscode",
      telemetry: false,
    });
    expect(result).not.toHaveProperty("baseURL");
    expect(JSON.stringify(result)).not.toContain("private-gateway");
  });
});
