import { copyFile, mkdir } from "node:fs/promises";

const target = new URL("../dist/preload/", import.meta.url);
await mkdir(target, { recursive: true });
await copyFile(
  new URL("../src/preload/preload.cjs", import.meta.url),
  new URL("preload.cjs", target),
);
