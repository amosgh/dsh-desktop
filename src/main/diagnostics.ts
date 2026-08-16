import type { SettingsSnapshot } from "../shared/contracts.js";

export function safeSettingsDiagnostics(settings: SettingsSnapshot): Omit<SettingsSnapshot, "baseURL"> {
  return {
    credentialConfigured: settings.credentialConfigured,
    model: settings.model,
    editor: settings.editor,
    telemetry: settings.telemetry,
  };
}
