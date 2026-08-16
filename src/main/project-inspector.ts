import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, parse } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface InspectedProject {
  name: string;
  path: string;
}

export async function inspectProject(selectedPath: string): Promise<InspectedProject> {
  const canonicalSelection = await realpath(selectedPath);
  const selectionStat = await stat(canonicalSelection);
  if (!selectionStat.isDirectory()) throw new Error("所选位置不是文件夹。");
  await access(canonicalSelection, constants.R_OK | constants.W_OK);

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      ["-C", canonicalSelection, "rev-parse", "--show-toplevel"],
      { timeout: 5_000, maxBuffer: 64 * 1024, encoding: "utf8" },
    ));
  } catch {
    throw new Error("请选择一个可读写的 Git 仓库。");
  }

  const repositoryRoot = await realpath(stdout.trim());
  await access(repositoryRoot, constants.R_OK | constants.W_OK);
  const root = parse(repositoryRoot).root;
  if (repositoryRoot === root) throw new Error("不能将文件系统根目录作为项目。");
  return { name: basename(repositoryRoot), path: repositoryRoot };
}

export function assertProjectId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) {
    throw new Error("Invalid project identifier.");
  }
}
