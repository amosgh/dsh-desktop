import { chmod, copyFile, mkdir } from "node:fs/promises";

const runtimeDirectory = new URL("../runtime/", import.meta.url);
const target = new URL("node", runtimeDirectory);

await mkdir(runtimeDirectory, { recursive: true });
await copyFile(process.execPath, target);
await chmod(target, 0o755);
console.log(`Bundled Node runtime from ${process.execPath}`);
