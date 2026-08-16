import { execFile } from "node:child_process";
import { access, mkdir, readFile, realpath, rm, statfs } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { FilePreview, GitChangedFile, GitReviewSnapshot, TaskWorkspaceRecord } from "../shared/contracts.js";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const MAX_DIFF_OUTPUT = 2 * 1024 * 1024;
const MAX_PREVIEW_OUTPUT = 1024 * 1024;

export class GitService {
  #worktreeRoot: string;
  #queues = new Map<string, Promise<unknown>>();

  constructor(worktreeRoot: string) {
    this.#worktreeRoot = resolve(worktreeRoot);
  }

  async createWorktree(projectId: string, repositoryPath: string, sessionId: string): Promise<TaskWorkspaceRecord> {
    return this.#withRepositoryLock(repositoryPath, async () => {
      const repository = await realpath(repositoryPath);
      const root = (await this.#git(repository, ["rev-parse", "--show-toplevel"])).trim();
      if (await realpath(root) !== repository) throw new Error("项目路径不是 Git 仓库根目录。");
      const baseSha = (await this.#git(repository, ["rev-parse", "HEAD"])).trim();
      if (!/^[0-9a-f]{40,64}$/i.test(baseSha)) throw new Error("无法确定任务的 Git 基线提交。");
      await this.#assertNoRepositoryOperation(repository);
      const branch = `dsh/${sessionId.replaceAll("-", "").slice(0, 12)}`;
      const parent = join(this.#worktreeRoot, projectId);
      const worktreePath = join(parent, sessionId);
      this.#assertGeneratedPath(worktreePath);
      await mkdir(parent, { recursive: true });
      const disk = await statfs(parent);
      if (Number(disk.bavail) * Number(disk.bsize) < 256 * 1024 * 1024) throw new Error("可用磁盘空间不足 256 MB，无法安全创建任务 worktree。");
      try {
        await this.#git(repository, ["worktree", "add", "-b", branch, worktreePath, baseSha]);
      } catch (error) {
        await rm(worktreePath, { recursive: true, force: true });
        throw error;
      }
      return {
        sessionId,
        projectId,
        repositoryPath: repository,
        worktreePath,
        branch,
        baseSha,
        createdAt: new Date().toISOString(),
        state: "active",
      };
    });
  }

  async rollbackWorktree(workspace: TaskWorkspaceRecord): Promise<void> {
    await this.#withRepositoryLock(workspace.repositoryPath, async () => {
      await this.#removeWorktree(workspace, true);
    });
  }

  async review(workspace: TaskWorkspaceRecord): Promise<GitReviewSnapshot> {
    return this.#withRepositoryLock(workspace.repositoryPath, async () => {
      try {
        await access(workspace.worktreePath);
        const [nameStatus, untracked, conflicts, numstat] = await Promise.all([
          this.#git(workspace.worktreePath, ["diff", "--name-status", "-z", workspace.baseSha, "--"]),
          this.#git(workspace.worktreePath, ["ls-files", "--others", "--exclude-standard", "-z"]),
          this.#git(workspace.worktreePath, ["diff", "--name-only", "--diff-filter=U", "-z"]),
          this.#git(workspace.worktreePath, ["diff", "--numstat", "-z", workspace.baseSha, "--"]),
        ]);
        const files = this.#parseChangedFiles(nameStatus, untracked, conflicts);
        const totals = this.#parseNumstat(numstat);
        return { sessionId: workspace.sessionId, workspace, phase: "ready", files, additions: totals.additions, deletions: totals.deletions, clean: files.length === 0 };
      } catch (error) {
        return { sessionId: workspace.sessionId, workspace, phase: "error", files: [], additions: 0, deletions: 0, clean: false, error: error instanceof Error ? error.message : String(error) };
      }
    });
  }

  async diff(workspace: TaskWorkspaceRecord, path: string): Promise<string> {
    return this.#withRepositoryLock(workspace.repositoryPath, async () => {
      const safePath = this.#validateRelativePath(path);
      const output = await this.#git(workspace.worktreePath, ["diff", "--no-ext-diff", "--no-color", "--unified=3", workspace.baseSha, "--", safePath], MAX_DIFF_OUTPUT);
      if (Buffer.byteLength(output) >= MAX_DIFF_OUTPUT - 1024) return `${output}\n\n[Diff output truncated by DSH Desktop]`;
      return output || "该文件没有可显示的文本差异；它可能是未跟踪文件、二进制文件，或只有模式变化。";
    });
  }

  async preview(workspace: TaskWorkspaceRecord, path: string): Promise<FilePreview> {
    return this.#withRepositoryLock(workspace.repositoryPath, async () => {
      const safePath = this.#validatePreviewPath(workspace, path);
      if (![".md", ".markdown"].includes(extname(safePath).toLowerCase())) throw new Error("当前仅支持在应用内预览 Markdown 文件。");
      let content: string;
      try {
        const root = await realpath(workspace.worktreePath);
        const target = await realpath(join(root, safePath));
        const rel = relative(root, target);
        if (!rel || rel.startsWith("..") || resolve(root, rel) !== target) throw new Error("Markdown 文件超出任务 worktree 范围。");
        const bytes = await readFile(target);
        if (bytes.byteLength > MAX_PREVIEW_OUTPUT) throw new Error("Markdown 文件超过 1 MB，无法在应用内预览。");
        content = bytes.toString("utf8");
      } catch (error) {
        if (error instanceof Error && (/超过|超出/.test(error.message))) throw error;
        content = await this.#git(workspace.worktreePath, ["show", `${workspace.baseSha}:${safePath}`], MAX_PREVIEW_OUTPUT);
      }
      if (Buffer.byteLength(content) >= MAX_PREVIEW_OUTPUT - 1024) throw new Error("Markdown 文件超过 1 MB，无法在应用内预览。");
      return { path: safePath, kind: "markdown", content };
    });
  }

  async commit(workspace: TaskWorkspaceRecord, message: string): Promise<string> {
    const normalized = message.trim();
    if (!normalized) throw new Error("提交说明不能为空。");
    return this.#withRepositoryLock(workspace.repositoryPath, async () => {
      await this.#git(workspace.worktreePath, ["add", "-A"]);
      const staged = (await this.#git(workspace.worktreePath, ["diff", "--cached", "--name-only"])).trim();
      if (staged) await this.#git(workspace.worktreePath, ["commit", "-m", normalized]);
      return (await this.#git(workspace.worktreePath, ["rev-parse", "HEAD"])).trim();
    });
  }

  async discard(workspace: TaskWorkspaceRecord): Promise<void> {
    await this.#withRepositoryLock(workspace.repositoryPath, async () => this.#removeWorktree(workspace, true));
  }

  async #removeWorktree(workspace: TaskWorkspaceRecord, deleteBranch: boolean): Promise<void> {
    this.#assertGeneratedPath(workspace.worktreePath);
    await this.#git(workspace.repositoryPath, ["worktree", "remove", "--force", workspace.worktreePath]).catch(async () => {
      await rm(workspace.worktreePath, { recursive: true, force: true });
      await this.#git(workspace.repositoryPath, ["worktree", "prune"]);
    });
    if (deleteBranch) await this.#git(workspace.repositoryPath, ["branch", "-D", workspace.branch]).catch(() => undefined);
  }

  async #assertNoRepositoryOperation(repository: string): Promise<void> {
    for (const marker of ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "BISECT_LOG"]) {
      const path = (await this.#git(repository, ["rev-parse", "--git-path", marker])).trim();
      try {
        await access(path);
        throw new Error(`仓库正在进行 ${marker} 操作，请先完成或中止该操作。`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("仓库正在进行")) throw error;
      }
    }
  }

  #parseChangedFiles(nameStatus: string, untracked: string, conflicts: string): GitChangedFile[] {
    const conflicted = new Set(conflicts.split("\0").filter(Boolean));
    const files = new Map<string, GitChangedFile>();
    const tokens = nameStatus.split("\0").filter(Boolean);
    for (let index = 0; index < tokens.length;) {
      const code = tokens[index++] ?? "M";
      const firstPath = tokens[index++];
      if (!firstPath) break;
      if (code.startsWith("R") || code.startsWith("C")) {
        const newPath = tokens[index++];
        if (newPath) files.set(newPath, { path: newPath, oldPath: firstPath, status: "renamed" });
      } else {
        files.set(firstPath, { path: firstPath, status: conflicted.has(firstPath) ? "conflicted" : this.#statusOf(code) });
      }
    }
    for (const path of untracked.split("\0").filter(Boolean)) if (!files.has(path)) files.set(path, { path, status: "untracked" });
    for (const path of conflicted) files.set(path, { path, status: "conflicted" });
    return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  #parseNumstat(output: string): { additions: number; deletions: number } {
    let additions = 0;
    let deletions = 0;
    for (const record of output.split("\0")) {
      const [added, removed] = record.split("\t");
      if (added && added !== "-") additions += Number.parseInt(added, 10) || 0;
      if (removed && removed !== "-") deletions += Number.parseInt(removed, 10) || 0;
    }
    return { additions, deletions };
  }

  #statusOf(code: string): GitChangedFile["status"] {
    if (code.startsWith("A")) return "added";
    if (code.startsWith("D")) return "deleted";
    if (code.startsWith("U")) return "conflicted";
    return "modified";
  }

  #validateRelativePath(path: string): string {
    if (!path || path.includes("\0") || resolve("/", path).startsWith("/../") || path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("文件路径无效。");
    return path;
  }

  #validatePreviewPath(workspace: TaskWorkspaceRecord, path: string): string {
    if (!isAbsolute(path)) return this.#validateRelativePath(path);
    if (path.includes("\0")) throw new Error("文件路径无效。");
    const root = resolve(workspace.worktreePath);
    const rel = relative(root, resolve(path));
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error("Markdown 文件超出任务 worktree 范围。");
    return this.#validateRelativePath(rel);
  }

  #assertGeneratedPath(path: string): void {
    const rel = relative(this.#worktreeRoot, resolve(path));
    if (!rel || rel.startsWith("..") || rel.split(/[\\/]/).length < 2) throw new Error("拒绝操作不受管理的 worktree 路径。");
  }

  async #git(cwd: string, args: string[], maxBuffer = MAX_GIT_OUTPUT): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer });
      return stdout;
    } catch (error) {
      const detail = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : undefined;
      throw new Error(detail || `Git command failed: git ${args[0] ?? ""}`);
    }
  }

  async #withRepositoryLock<T>(repository: string, operation: () => Promise<T>): Promise<T> {
    const key = resolve(repository);
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.#queues.set(key, current);
    try {
      return await current;
    } finally {
      if (this.#queues.get(key) === current) this.#queues.delete(key);
    }
  }
}
