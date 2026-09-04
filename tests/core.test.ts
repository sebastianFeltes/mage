import { describe, expect, test } from "bun:test";
import createPlugin from "@extism/extism";
import { resolve } from "node:path";
import { loadConfig } from "../src/config";
import { localEmbedding } from "../src/llm/provider";
import { PlanSchema } from "../src/llm/schemas";
import { tryFastPath } from "../src/loop/fastpath";
import { HybridMemory } from "../src/memory/hybrid";
import { WasmPool } from "../src/sandbox/pool";
import { SandboxTimeout, WasmSandbox } from "../src/sandbox/runner";
import { ToolRegistry } from "../src/tools/registry";

import { BUILTIN_WASM_TOOLS } from "../src/tools/builtin";

const pluginsDir = resolve(import.meta.dir, "../plugins");
const builtinWasm = resolve(pluginsDir, "toolkit.wasm");

const makePool = () =>
  new WasmPool(pluginsDir, 50, createPlugin, builtinWasm, BUILTIN_WASM_TOOLS.map((t) => ({
    ...t,
    wasmPath: builtinWasm,
  })));

describe("fast path", () => {
  test("math sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("cuánto es (12+8)*3", pool);
    expect(hit?.answer).toBe("60");
    expect(hit?.plan.toolCalls[0]?.tool).toBe("calc");
  });

  test("hash sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("hash de mage", pool);
    expect(hit?.answer).toMatch(/^fnv1a:/);
  });

  test("count_letter sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath(
      "cuantas letras R tiene la palabra supercalifragilisticoespialidoso?",
      pool,
    );
    expect(hit?.answer).toContain("2");
    expect(hit?.plan.toolCalls[0]?.tool).toBe("count_letter");
  });

  test("palindrome sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("verifica si anita lava la tina es palindromo", pool);
    expect(hit?.answer).toMatch(/Sí/i);
  });

  test("next_prime sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("encontra el primer numero primo mayor a 500.000", pool);
    expect(hit?.answer).toContain("500009");
  });

  test("valida con calc sin LLM", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("valida con calc: 500000 + 9", pool);
    expect(hit?.answer).toBe("500009");
  });

  test("expresión pura sin prefijo", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("(12+8)*3", pool);
    expect(hit?.answer).toBe("60");
    expect(hit?.plan.toolCalls[0]?.tool).toBe("calc");
  });

  test("hash sin 'de'", async () => {
    const pool = makePool();
    await pool.warm();
    const hit = await tryFastPath("hash mage", pool);
    expect(hit?.answer).toMatch(/^fnv1a:/);
  });
});

describe("config", () => {
  test("embed local por defecto", () => {
    const prev = process.env.MAGE_EMBED_PROVIDER;
    delete process.env.MAGE_EMBED_PROVIDER;
    const cfg = loadConfig();
    expect(cfg.embedProvider).toBe("none");
    if (prev) process.env.MAGE_EMBED_PROVIDER = prev;
  });

  test("defaults to gemini flash", () => {
    const prev = {
      provider: process.env.MAGE_PROVIDER,
      script: process.env.MAGE_SCRIPT_ENABLED,
      cors: process.env.MAGE_CORS_ORIGINS,
      rate: process.env.MAGE_RATE_LIMIT_PER_MIN,
      graph: process.env.MAGE_GRAPH,
    };
    delete process.env.MAGE_PROVIDER;
    delete process.env.MAGE_SCRIPT_ENABLED;
    delete process.env.MAGE_CORS_ORIGINS;
    delete process.env.MAGE_RATE_LIMIT_PER_MIN;
    delete process.env.MAGE_GRAPH;
    const cfg = loadConfig();
    expect(cfg.provider).toBe("gemini");
    expect(cfg.fastModel).toBe("gemini-3.6-flash");
    expect(cfg.wasmTimeoutMs).toBe(50);
    expect(cfg.enrichBudgetMs).toBe(25);
    expect(cfg.scriptEnabled).toBe(false);
    expect(cfg.corsOrigins).toEqual([]);
    expect(cfg.rateLimitPerMin).toBe(60);
    expect(cfg.graphBackend).toBe("sqlite");
    if (prev.provider) process.env.MAGE_PROVIDER = prev.provider;
    if (prev.script) process.env.MAGE_SCRIPT_ENABLED = prev.script;
    if (prev.cors) process.env.MAGE_CORS_ORIGINS = prev.cors;
    if (prev.rate) process.env.MAGE_RATE_LIMIT_PER_MIN = prev.rate;
    if (prev.graph) process.env.MAGE_GRAPH = prev.graph;
  });
});

describe("zod plan", () => {
  test("accepts compact plan con relaciones", () => {
    const plan = PlanSchema.parse({
      thought: "ok",
      confidence: 0.9,
      proposedAnswer: "42",
      relationCandidates: [{ type: "DEPENDE_DE", from: "A", to: "B" }],
    });
    expect(plan.toolCalls).toEqual([]);
    expect(plan.relationCandidates).toHaveLength(1);
  });
});

describe("local embedding", () => {
  test("is normalized and stable", () => {
    const a = localEmbedding("mage");
    const b = localEmbedding("mage");
    expect(a.length).toBe(64);
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
    expect(dot).toBeCloseTo(1, 5);
  });
});

describe("sandbox timeout", () => {
  test("corta a 50ms", async () => {
    const box = new WasmSandbox(
      "x.wasm",
      50,
      async () => ({
        call: () => new Promise((r) => setTimeout(r, 200, "late")),
      }),
    );
    await expect(box.run("calc", "{}")).rejects.toBeInstanceOf(SandboxTimeout);
  });

  test("reusa el plugin", async () => {
    let created = 0;
    const box = new WasmSandbox("x.wasm", 50, async () => {
      created++;
      return { call: async () => '{"ok":true,"value":3}' };
    });
    await box.run("calc", '{"expr":"1+2"}');
    await box.run("calc", '{"expr":"1+2"}');
    expect(created).toBe(1);
  });
});

describe("tools registry", () => {
  test("catalogo minimo", () => {
    const names = new ToolRegistry().list().map((t) => t.name).sort();
    expect(names).toEqual([
      "calc",
      "count_letter",
      "hash",
      "is_palindrome",
      "json_validate",
      "kpi.lookup",
      "memory.ingest",
      "memory.search",
      "next_prime",
      "rule.check",
      "script.run",
      "source.cite",
    ]);
  });

  test("rechaza input inválido sin tocar wasm", async () => {
    const pool = makePool();
    const reg = new ToolRegistry(pool);
    const script = new (await import("../src/sandbox/script")).ScriptRunner({
      ...loadConfig(),
      scriptEnabled: true,
      scriptTimeoutMs: 1000,
    });
    await expect(
      reg.dispatch("calc", { nope: 1 }, pool, { memorySearch: async () => [], script }),
    ).rejects.toThrow();
  });
});

describe("wasm toolkit", () => {
  test("calc y hash < 15ms", async () => {
    const pool = makePool();
    await pool.warm();
    const calc = await pool.run("calc", JSON.stringify({ expr: "(2+3)*4" }));
    expect(calc.output).toContain('"value":20');
    expect(calc.ms).toBeLessThan(15);
    const hash = await pool.run("hash", JSON.stringify({ text: "mage" }));
    expect(hash.output).toContain("fnv1a");
    expect(hash.ms).toBeLessThan(15);
  });
});

describe("hybrid budget", () => {
  test("no espera al grafo lento", async () => {
    const hybrid = new HybridMemory(
      {
        ...loadConfig(),
        embedProvider: "gemini",
        enrichBudgetMs: 20,
        graphLimit: 8,
        vectorTopK: 5,
      },
      {
        search: () =>
          new Promise((r) =>
            setTimeout(r, 200, [{ label: "Hecho", name: "late", text: "late", score: 1 }]),
          ),
      } as never,
      {
        search: async () => [{ id: "fast", text: "fast", score: 0.9 }],
      } as never,
    );
    const t0 = performance.now();
    const hits = await hybrid.search("x");
    expect(performance.now() - t0).toBeLessThan(80);
    expect(hits.some((h) => h.name === "fast")).toBe(true);
    expect(hits.some((h) => h.name === "late")).toBe(false);
  });

  test("embed none no usa vectores FNV", async () => {
    const hybrid = new HybridMemory(
      {
        ...loadConfig(),
        embedProvider: "none",
        enrichBudgetMs: 20,
        graphLimit: 8,
        vectorTopK: 5,
      },
      {
        search: async () => [{ label: "Hecho", name: "kpi", text: "arr", score: 1 }],
      } as never,
      {
        search: async () => [{ id: "fnv-junk", text: "no semántico", score: 0.99 }],
      } as never,
    );
    const hits = await hybrid.search("arr");
    expect(hits.some((h) => h.name === "kpi")).toBe(true);
    expect(hits.some((h) => h.name === "fnv-junk")).toBe(false);
    expect(hits.every((h) => h.source === "graph")).toBe(true);
  });
});
