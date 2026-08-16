import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { markdownDocument, readHarnessMarkdown } from "./harness-preview.js";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("Harness Markdown preview", () => {
  it("reads only contained Markdown and rejects symlink escapes", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-preview-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    await mkdir(workspace);
    await writeFile(join(workspace, "report.md"), "# Report");
    await writeFile(join(root, "secret.md"), "secret");
    await symlink(join(root, "secret.md"), join(workspace, "escape.md"));
    await expect(readHarnessMarkdown(join(workspace, "report.md"), [workspace])).resolves.toMatchObject({ kind: "markdown" });
    await expect(readHarnessMarkdown(join(workspace, "escape.md"), [workspace])).rejects.toThrow("工作区");
    await expect(readHarnessMarkdown(join(root, "secret.md"), [workspace])).rejects.toThrow("工作区");
  });

  it("escapes raw HTML and routes Markdown and web links through the panel scheme", () => {
    const html = markdownDocument({ path: "/workspace/docs/report.md", kind: "markdown", content: "# <script>x</script>\n\n[Next](next.md) [Web](https://example.com?q=1)" }, false);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).toContain("dsh-preview://file?path=%2Fworkspace%2Fdocs%2Fnext.md");
    expect(html).toContain("dsh-preview://web?url=https%3A%2F%2Fexample.com%3Fq%3D1");
  });
});
