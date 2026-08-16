import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "./App.js";

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
