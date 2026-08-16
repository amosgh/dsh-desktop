import { readFile, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import type { FilePreview } from "../shared/contracts.js";

const MAX_PREVIEW_BYTES = 1024 * 1024;

export async function readHarnessMarkdown(path: string, allowedRoots: string[]): Promise<FilePreview> {
  if (!isAbsolute(path) || ![".md", ".markdown"].includes(extname(path).toLowerCase())) throw new Error("只能预览 Harness 工作区内的 Markdown 文件。");
  const target = await realpath(path);
  let contained = false;
  for (const candidate of allowedRoots) {
    if (!isAbsolute(candidate)) continue;
    try {
      const root = await realpath(candidate);
      const rel = relative(root, target);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) { contained = true; break; }
    } catch {
      // Missing historical workspace roots do not grant access.
    }
  }
  if (!contained) throw new Error("该文件不在当前 Harness 会话或已授权项目的工作区内。");
  const bytes = await readFile(target);
  if (bytes.byteLength > MAX_PREVIEW_BYTES) throw new Error("Markdown 文件超过 1 MB，无法在应用内预览。");
  return { path: target, kind: "markdown", content: bytes.toString("utf8") };
}

function escapeHTML(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function previewLink(currentPath: string, href: string): string | undefined {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) return `dsh-preview://web?url=${encodeURIComponent(trimmed)}`;
  const clean = trimmed.split(/[?#]/, 1)[0] ?? "";
  let decoded: string;
  try { decoded = /^file:\/\//i.test(clean) ? decodeURIComponent(new URL(clean).pathname) : decodeURIComponent(clean); }
  catch { return undefined; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || !/\.md(?:own)?$/i.test(decoded)) return undefined;
  const target = isAbsolute(decoded) ? resolve(decoded) : resolve(dirname(currentPath), decoded);
  return `dsh-preview://file?path=${encodeURIComponent(target)}`;
}

function renderInline(text: string, currentPath: string): string {
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s<]+)/g;
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    html += escapeHTML(text.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("`")) html += `<code>${escapeHTML(token.slice(1, -1))}</code>`;
    else {
      const markdown = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const label = escapeHTML(markdown?.[1] ?? token);
      const target = previewLink(currentPath, markdown?.[2] ?? token);
      html += target ? `<a href="${escapeHTML(target)}">${label}</a>` : label;
    }
    cursor = index + token.length;
  }
  return html + escapeHTML(text.slice(cursor));
}

function renderMarkdown(content: string, currentPath: string): string {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) code.push(lines[index++] ?? "");
      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHTML(code.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(4, heading[1]?.length ?? 1);
      blocks.push(`<h${level}>${renderInline(heading[2] ?? "", currentPath)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) items.push((lines[index++] ?? "").replace(/^\s*[-*+]\s+/, ""));
      blocks.push(`<ul>${items.map((item) => `<li>${renderInline(item, currentPath)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) quote.push((lines[index++] ?? "").replace(/^>\s?/, ""));
      blocks.push(`<blockquote>${renderInline(quote.join(" "), currentPath)}</blockquote>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { blocks.push("<hr>"); index += 1; continue; }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && (lines[index] ?? "").trim() && !/^(?:#{1,6}\s|```|\s*[-*+]\s+|>\s?)/.test(lines[index] ?? "")) paragraph.push((lines[index++] ?? "").trim());
    blocks.push(`<p>${renderInline(paragraph.join(" "), currentPath)}</p>`);
  }
  return blocks.join("\n");
}

function themeCSS(dark: boolean): string {
  const colors = dark
    ? "--bg:#17171a;--surface:#202024;--ink:#f3f3f4;--muted:#a7a7af;--line:#34343a;--accent:#8f83ff;"
    : "--bg:#fff;--surface:#f7f7f8;--ink:#202024;--muted:#6f7078;--line:#e2e2e6;--accent:#5142d6;";
  return `:root{${colors}color-scheme:${dark ? "dark" : "light"}}*{box-sizing:border-box}html,body{height:100%;margin:0}body{overflow:auto;background:var(--bg);color:var(--ink);font:13px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}a{color:var(--accent);text-underline-offset:2px}code{border-radius:4px;background:var(--surface);padding:.12em .35em;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}pre{overflow:auto;border-radius:8px;background:var(--surface);padding:13px;white-space:pre}pre code{background:transparent;padding:0}main{padding:22px 26px 40px}main>:first-child{margin-top:0}h1,h2,h3,h4{margin:1.45em 0 .55em;line-height:1.3;text-wrap:balance}h1{border-bottom:1px solid var(--line);padding-bottom:.35em;font-size:22px}h2{font-size:17px}h3,h4{font-size:14px}p,li,blockquote{max-width:72ch;text-wrap:pretty}ul,ol{padding-left:22px}blockquote{margin-inline:0;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:10px 12px;color:var(--muted)}hr{margin:24px 0;border:0;border-top:1px solid var(--line)}.state{display:grid;height:100%;place-content:center;padding:28px;color:var(--muted);text-align:center}.state strong{color:var(--ink)}.state p{max-width:42ch;margin:6px 0 0}`;
}

export function markdownDocument(preview: FilePreview, dark: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${themeCSS(dark)}</style></head><body><main>${renderMarkdown(preview.content, preview.path)}</main></body></html>`;
}

export function previewStateDocument(title: string, message: string, dark: boolean): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>${themeCSS(dark)}</style></head><body><div class="state"><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p></div></body></html>`;
}

export function previewChromeDocument(title: string, subtitle: string, dark: boolean, browser = false): string {
  const controls = browser ? '<nav><a href="dsh-preview://back" aria-label="后退">‹</a><a href="dsh-preview://forward" aria-label="前进">›</a><a href="dsh-preview://reload" aria-label="刷新">↻</a></nav>' : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>:root{${dark ? "--bg:#17171a;--ink:#f3f3f4;--muted:#a7a7af;--line:#34343a" : "--bg:#fff;--ink:#202024;--muted:#777780;--line:#e2e2e6"};color-scheme:${dark ? "dark" : "light"}}*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line);background:var(--bg);color:var(--ink);padding:7px 9px 7px 12px;font:11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-app-region:drag}nav{display:flex;gap:2px;-webkit-app-region:no-drag}a{display:grid;width:28px;height:28px;place-items:center;border-radius:6px;color:var(--muted);font-size:17px;text-decoration:none;-webkit-app-region:no-drag}a:hover{background:color-mix(in srgb,var(--ink) 7%,transparent);color:var(--ink)}div{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px}strong,span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}strong{font-weight:650}span{color:var(--muted);font-size:9px}.close{font-size:19px}</style></head><body>${controls}<div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(subtitle)}</span></div><a class="close" href="dsh-preview://close" aria-label="关闭">×</a></body></html>`;
}

export function htmlDataURL(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}
