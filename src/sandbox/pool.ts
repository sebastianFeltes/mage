import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { WasmSandbox, type CreatePlugin } from "./runner";

export type WasmToolBinding = {
  name: string;
  exportName: string;
  wasmPath: string;
};

const ManifestSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      export: z.string(),
      wasm: z.string(),
      description: z.string().optional(),
    }),
  ),
});

export class WasmPool {
  private readonly byWasm = new Map<string, WasmSandbox>();
  private readonly byTool = new Map<string, WasmToolBinding>();
  private warming: Promise<void> | null = null;

  constructor(
    private readonly pluginsDir: string,
    private readonly timeoutMs: number,
    private readonly createPlugin: CreatePlugin,
    builtinWasm: string,
    builtinTools: WasmToolBinding[],
  ) {
    for (const t of builtinTools) {
      this.byTool.set(t.name, { ...t, wasmPath: builtinWasm });
    }
  }

  async warm(): Promise<void> {
    if (this.warming) return this.warming;
    this.warming = (async () => {
      await this.loadExternal();
      const paths = new Set([...this.byTool.values()].map((t) => t.wasmPath));
      await Promise.all(
        [...paths].map(async (p) => {
          const s = await this.sandboxFor(p);
          await s.warm().catch(() => undefined);
        }),
      );
    })();
    return this.warming;
  }

  bindings(): WasmToolBinding[] {
    return [...this.byTool.values()];
  }

  async run(tool: string, input: string): Promise<{ output: string; ms: number }> {
    const binding = this.byTool.get(tool);
    if (!binding) throw new Error(`wasm tool no registrada: ${tool}`);
    const sandbox = await this.sandboxFor(binding.wasmPath);
    const result = await sandbox.run(binding.exportName, input);
    return { output: result.output, ms: result.ms };
  }

  private async sandboxFor(wasmPath: string): Promise<WasmSandbox> {
    let box = this.byWasm.get(wasmPath);
    if (!box) {
      box = new WasmSandbox(wasmPath, this.timeoutMs, this.createPlugin);
      this.byWasm.set(wasmPath, box);
    }
    return box;
  }

  private async loadExternal(): Promise<void> {
    const manifestPath = join(this.pluginsDir, "manifest.json");
    if (!existsSync(manifestPath)) return;
    const raw = await readFile(manifestPath, "utf8");
    const manifest = ManifestSchema.parse(JSON.parse(raw));
    for (const t of manifest.tools) {
      const wasmPath = resolve(this.pluginsDir, t.wasm);
      if (!existsSync(wasmPath)) continue;
      this.byTool.set(t.name, { name: t.name, exportName: t.export, wasmPath });
    }

    // auto-descubrir *.wasm sueltos (export = nombre del archivo sin ext)
    const files = await readdir(this.pluginsDir);
    for (const file of files) {
      if (!file.endsWith(".wasm") || file === "toolkit.wasm") continue;
      const base = file.replace(/\.wasm$/, "");
      if (this.byTool.has(base)) continue;
      this.byTool.set(base, {
        name: base,
        exportName: base,
        wasmPath: resolve(this.pluginsDir, file),
      });
    }
  }
}
