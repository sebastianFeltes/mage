import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config";
import { ScriptRunner } from "../src/sandbox/script";
import { WasmPool } from "../src/sandbox/pool";
import createPlugin from "@extism/extism";
import { ToolRegistry } from "../src/tools/registry";
import { resolve } from "node:path";
import { BUILTIN_WASM_TOOLS } from "../src/tools/builtin";

describe("script.run", () => {
  test("ejecuta código y captura stdout", async () => {
    const cfg = { ...loadConfig(), scriptEnabled: true, scriptTimeoutMs: 3000 };
    const runner = new ScriptRunner(cfg);
    const r = await runner.run({
      code: `
const xs = [1, 2, 3, 4];
return xs.reduce((a, b) => a + b, 0);
`,
    });
    expect(r.ok).toBe(true);
    expect(r.stdout.trim()).toBe("10");
    expect(r.exitCode).toBe(0);
  });

  test("bloquea fetch", async () => {
    const cfg = { ...loadConfig(), scriptEnabled: true, scriptTimeoutMs: 1000 };
    const runner = new ScriptRunner(cfg);
    expect(runner.run({ code: 'await fetch("http://x")' })).rejects.toThrow(/bloqueado/);
  });

  test("bloquea Bun.write y eval", async () => {
    const cfg = { ...loadConfig(), scriptEnabled: true, scriptTimeoutMs: 1000 };
    const runner = new ScriptRunner(cfg);
    expect(runner.run({ code: 'await Bun.write("/tmp/x", "y")' })).rejects.toThrow(/bloqueado/);
    expect(runner.run({ code: "eval('1')" })).rejects.toThrow(/bloqueado/);
  });

  test("deshabilitado sin env", async () => {
    const cfg = { ...loadConfig(), scriptEnabled: false, scriptTimeoutMs: 1000 };
    const runner = new ScriptRunner(cfg);
    expect(runner.run({ code: "return 1" })).rejects.toThrow(/deshabilitado/);
  });
});

describe("registry script.run", () => {
  test("dispatch script via host", async () => {
    const cfg = { ...loadConfig(), scriptEnabled: true, scriptTimeoutMs: 3000 };
    const runner = new ScriptRunner(cfg);
    const pluginsDir = resolve(import.meta.dir, "../plugins");
    const wasm = resolve(pluginsDir, "toolkit.wasm");
    const pool = new WasmPool(pluginsDir, 50, createPlugin, wasm, BUILTIN_WASM_TOOLS.map((t) => ({
      ...t,
      wasmPath: wasm,
    })));
    const reg = new ToolRegistry(pool);
    const { output } = await reg.dispatch(
      "script.run",
      { code: "console.log('hola mage')" },
      pool,
      { memorySearch: async () => [], script: runner },
    );
    const parsed = output as { ok: boolean; stdout: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.stdout.trim()).toBe("hola mage");
  });
});
