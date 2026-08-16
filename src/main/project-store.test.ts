import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectStore } from "./project-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("ProjectStore", () => {
  it("deduplicates canonical paths and persists the active project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-project-store-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "desktop.sqlite");

    const firstStore = new ProjectStore(databasePath);
    const first = firstStore.addOrTouch("alpha", "/tmp/alpha");
    const duplicate = firstStore.addOrTouch("Alpha", "/tmp/alpha");
    const second = firstStore.addOrTouch("beta", "/tmp/beta");
    firstStore.saveTaskWorkspace({ sessionId: "session-1", projectId: first.id, repositoryPath: "/tmp/alpha", worktreePath: "/tmp/wt", branch: "dsh/test", baseSha: "abc", createdAt: new Date().toISOString(), state: "active" });
    expect(firstStore.getTaskWorkspace("session-1")?.branch).toBe("dsh/test");
    expect(duplicate.id).toBe(first.id);
    expect(firstStore.list()).toHaveLength(2);
    expect(firstStore.activate(second.id)?.active).toBe(true);
    firstStore.close();

    const reopened = new ProjectStore(databasePath);
    expect(reopened.list().find((project) => project.id === second.id)?.active).toBe(true);
    expect(reopened.listTaskWorkspaces(first.id)).toHaveLength(1);
    expect(reopened.remove(second.id)).toBe(true);
    expect(reopened.list()).toHaveLength(1);
    reopened.close();
  });
});
