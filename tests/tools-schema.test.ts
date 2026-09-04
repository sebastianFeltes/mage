import { describe, expect, test } from "bun:test";
import createPlugin from "@extism/extism";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import type { Plan } from "../src/llm/schemas";
import { finalizeResult, type MageTimings } from "../src/loop/result";
import { SandboxError } from "../src/sandbox/runner";
import { ScriptRunner } from "../src/sandbox/script";
import { WasmPool } from "../src/sandbox/pool";
import { BUILTIN_WASM_TOOLS } from "../src/tools/builtin";
import { ToolRegistry } from "../src/tools/registry";

const pluginsDir = resolve(import.meta.dir, "../plugins");
const builtinWasm = resolve(pluginsDir, "toolkit.wasm");

const makePool = () =>
  new WasmPool(
    pluginsDir,
    50,
    createPlugin,
    builtinWasm,
    BUILTIN_WASM_TOOLS.map((t) => ({ ...t, wasmPath: builtinWasm })),
  );

const dummyHost = {
  memorySearch: async () => [],
  script: new ScriptRunner({
    ...loadConfig(),
    scriptEnabled: false,
    scriptTimeoutMs: 1000,
  }),
};

const timings = (): MageTimings => ({
  bootMs: 0,
  enrichMs: 0,
  planMs: 0,
  sandboxMs: 1,
  totalMs: 1,
  attempts: 1,
  usedReasonModel: false,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  thought: "modelo",
  confidence: 0.9,
  assumptions: [],
  toolCalls: [{ tool: "calc", input: { expr: "0.1+0.2" }, reason: "aritmética" }],
  proposedAnswer: "el modelo dice 1.5",
  memoryCandidates: [],
  relationCandidates: [],
  ...over,
});

describe("tools schema", () => {
  test("calc_desde_schema", async () => {
    const pool = makePool();
    await pool.warm();
    const reg = new ToolRegistry(pool);
    const { output } = await reg.dispatch("calc", { expr: "0.1+0.2" }, pool, dummyHost);
    const rec = output as { ok: boolean; value: number };
    expect(typeof rec.value).toBe("number");
    expect(Number.isFinite(rec.value)).toBe(true);

    const result = finalizeResult({
      plan: plan(),
      evidence: [
        {
          id: "e1",
          tool: "calc",
          input: { expr: "0.1+0.2" },
          output,
          ms: 1,
        },
      ],
      draft: "el modelo dice 1.5",
      timings: timings(),
    });
    expect(result.status).toBe("answered");
    expect(result.answer).toBe(String(rec.value));
    expect(result.answer).not.toContain("modelo");
    expect(result.answer).not.toBe("1.5");
  });

  test("wasm json inválido es error de tool", async () => {
    const pool = {
      run: async () => ({ output: "no-es-json", ms: 1 }),
      bindings: () => [],
    } as never;
    const reg = new ToolRegistry();
    await expect(reg.dispatch("calc", { expr: "1+1" }, pool)).rejects.toBeInstanceOf(SandboxError);
  });

  test("output sin value no pasa CalcOutput", async () => {
    const pool = {
      run: async () => ({ output: '{"ok":true}', ms: 1 }),
      bindings: () => [],
    } as never;
    const reg = new ToolRegistry();
    await expect(reg.dispatch("calc", { expr: "1+1" }, pool)).rejects.toBeInstanceOf(SandboxError);
  });
});
