import { describe, expect, test } from "bun:test";
import createPlugin from "@extism/extism";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { createRuntime, runMage } from "../src/loop/metacog";
import { tryFastPath } from "../src/loop/fastpath";
import { SessionTenantMismatchError } from "../src/session/errors";
import { resetSessionStore } from "../src/session/store";
import { WasmPool } from "../src/sandbox/pool";
import { BUILTIN_WASM_TOOLS } from "../src/tools/builtin";

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

describe("ola 12 fast path AST", () => {
  test("ast_calc_puro", async () => {
    const pool = makePool();
    await pool.warm();
    const a = await tryFastPath("(12+8)*3", pool);
    expect(a?.answer).toBe("60");
    expect(a?.plan.toolCalls[0]?.tool).toBe("calc");
    const b = await tryFastPath("2+2", pool);
    expect(b?.answer).toBe("4");
    const c = await tryFastPath("cuánto es (12+8)*3", pool);
    expect(c?.answer).toBe("60");
  });

  test("ast_incompleto_no_match", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("(12+8)*", pool);
    expect(hit).toBeNull();
  });

  test("ast_rechaza_basura", async () => {
    const pool = makePool();
    await pool.warm();
    expect(await tryFastPath("hola 2+2", pool)).toBeNull();
    expect(await tryFastPath("PIB 12+8", pool)).toBeNull();
  });

  test("hash_y_json_siguen", async () => {
    const pool = makePool();
    await pool.warm();
    const hash = await tryFastPath("hash de mage", pool);
    expect(hash?.answer).toMatch(/^fnv1a:/);
    const json = await tryFastPath('{ "a": 1 }', pool);
    expect(json?.answer).toBe("JSON válido");
    expect(json?.plan.toolCalls[0]?.tool).toBe("json_validate");
    expect(await tryFastPath('{"program":"sort","input":[3,1,4,1,5]}', pool)).toBeNull();
  });

  test("runMage preserva respuesta demo formateada", async () => {
    resetSessionStore();
    const rt = await createRuntime({ ...loadConfig(), provider: "stub", sessionStore: "memory" });
    const pal = await runMage("verifica si anita lava la tina es palindromo", rt);
    expect(pal.status).toBe("answered");
    expect(pal.answer).toMatch(/Sí/i);
    const json = await runMage('{ "a": 1 }', rt);
    expect(json.answer).toBe("JSON válido");
    resetSessionStore();
  });
});
