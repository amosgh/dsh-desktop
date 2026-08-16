const URL_LINE = /^dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)\s*$/m;

export function parseHarnessUrl(output: string): string | undefined {
  const match = URL_LINE.exec(output);
  if (!match?.[1]) return undefined;

  const parsed = new URL(match[1]);
  if (parsed.hostname !== "127.0.0.1" || parsed.protocol !== "http:") {
    return undefined;
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return parsed.origin;
}

export function redactLogLine(line: string): string {
  return line
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:api[_-]?key|access[_-]?token|token|secret)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .slice(0, 4_000);
}
