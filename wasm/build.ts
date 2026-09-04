import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outDir = join(root, "plugins");
await mkdir(outDir, { recursive: true });

const out = join(outDir, "toolkit.wasm");
const input = join(root, "wasm/toolkit.ts");

const proc = Bun.spawn(
  [
    "bunx",
    "asc",
    input,
    "--outFile",
    out,
    "-O3",
    "--noAssert",
    "--optimizeLevel",
    "3",
    "--shrinkLevel",
    "2",
    "--runtime",
    "incremental",
    "--exportRuntime",
    "--use",
    "abort=wasm/toolkit/abort",
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);

const code = await proc.exited;
if (code !== 0) {
  throw new Error(`asc falló con código ${code}`);
}
console.log(`wasm -> ${out}`);
