import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { assertProjectId, inspectProject } from "./project-inspector.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("inspectProject", () => {
  it("resolves a selected subdirectory to its canonical Git root", async () => {
    const repository = await mkdtemp(join(tmpdir(), "dsh-project-"));
    temporaryDirectories.push(repository);
    await execFileAsync("git", ["init", "--quiet", repository]);
    const nested = join(repository, "src", "feature");
    await mkdir(nested, { recursive: true });
    const canonicalRepository = await realpath(repository);

    await expect(inspectProject(nested)).resolves.toEqual({
      name: repository.split("/").at(-1),
      path: canonicalRepository,
    });
  });

  it("rejects malformed project identifiers", () => {
    expect(() => assertProjectId("../escape")).toThrow("Invalid project identifier");
  });
});
