import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { GitService } from "./git-service.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("GitService", () => {
  it("creates isolated worktrees, reviews, commits and safely discards them", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-git-service-"));
    temporaryDirectories.push(root);
    const repository = join(root, "repository");
    const worktrees = join(root, "worktrees");
    await execFileAsync("git", ["init", "--quiet", repository]);
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repository });
    await execFileAsync("git", ["config", "user.name", "DSH Test"], { cwd: repository });
    await writeFile(join(repository, "hello.txt"), "hello\n");
    await execFileAsync("git", ["add", "hello.txt"], { cwd: repository });
    await execFileAsync("git", ["commit", "--quiet", "-m", "initial"], { cwd: repository });

    const service = new GitService(worktrees);
    const workspace = await service.createWorktree("project-1", repository, "11111111-1111-4111-8111-111111111111");
    expect(workspace.worktreePath).toContain("11111111-1111-4111-8111-111111111111");
    await writeFile(join(workspace.worktreePath, "hello.txt"), "hello world\n");
    await writeFile(join(workspace.worktreePath, "new.txt"), "new\n");
    const review = await service.review(workspace);
    expect(review.files.map((file) => file.path)).toEqual(["hello.txt", "new.txt"]);
    expect(await service.diff(workspace, "hello.txt")).toContain("hello world");
    expect(await service.commit(workspace, "finish task")).toMatch(/^[0-9a-f]{40}$/);
    await service.discard(workspace);
    await expect(execFileAsync("git", ["show-ref", "--verify", `refs/heads/${workspace.branch}`], { cwd: repository })).rejects.toBeTruthy();
  });
});
