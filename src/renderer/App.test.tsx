import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { classifyMarkdownHref, MarkdownPreview } from "./App.js";

describe("MarkdownPreview", () => {
  it("renders document structure without injecting raw HTML", () => {
    const html = renderToStaticMarkup(<MarkdownPreview
      preview={{ path: "docs/README.md", kind: "markdown", content: "# Title\n\n<script>alert(1)</script>\n\n[Guide](guide.md)\n" }}
      onOpenFile={() => undefined}
      onError={() => undefined}
    />);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Guide");
  });
});

describe("classifyMarkdownHref", () => {
  it("routes web, relative, absolute and file Markdown links", () => {
    expect(classifyMarkdownHref("docs/README.md", "guide.md")).toEqual({ kind: "file", value: "docs/guide.md" });
    expect(classifyMarkdownHref("", "reports/result.md")).toEqual({ kind: "file", value: "reports/result.md" });
    expect(classifyMarkdownHref("", "/tmp/worktree/report.md")).toEqual({ kind: "file", value: "/tmp/worktree/report.md" });
    expect(classifyMarkdownHref("", "file:///tmp/worktree/My%20Report.md")).toEqual({ kind: "file", value: "/tmp/worktree/My Report.md" });
    expect(classifyMarkdownHref("", "https://example.com/docs?q=1#intro")).toEqual({ kind: "web", value: "https://example.com/docs?q=1#intro" });
  });

  it("rejects traversal, non-Markdown files and executable schemes", () => {
    expect(classifyMarkdownHref("", "../secret.md")).toBeUndefined();
    expect(classifyMarkdownHref("", "notes.txt")).toBeUndefined();
    expect(classifyMarkdownHref("", "javascript:alert(1)")).toBeUndefined();
  });
});
